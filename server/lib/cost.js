// 成本与毛利计算
// 物料含税成本单价 = internal_price × 1.05(加成) × (已含税 ? 1 : 1 + 税率)
// 渠道成本 = 主路径(priority=0)BOM 物料 + 该渠道包装 + 该渠道酱料,各 × 成本单价
// 毛利率 = (渠道售价 − 渠道成本) / 渠道售价。替换品不计入成本基准。
import { db, getSetting } from '../db.js';

const MARKUP = 1.05; // ×5% 加成(口径:内部转移价上加 5% 作为单品成本)

export function getTaxRate() {
  const v = parseFloat(getSetting('tax_rate'));
  return Number.isFinite(v) ? v : 0.07;
}

// 含税成本单价;internal_price 为空 → 返回 null(该物料缺价)
// 税率取该物料 ERP Item Tax Template 税率(materials.tax_rate);
// 若价已含税(price_includes_tax,来自 custom_tax=VAT Included)则不再乘税
export function materialUnitCost(mat) {
  if (!mat || mat.internal_price == null) return null;
  const rate = mat.price_includes_tax ? 0 : (Number(mat.tax_rate) || 0);
  return mat.internal_price * MARKUP * (1 + rate);
}

// 解析 {code,qty}[] / ["code"] / 单值,与 combos.js 的 parseEntries 一致
function parseEntries(text, fallbackSingle) {
  if (text) {
    try {
      const arr = JSON.parse(text);
      if (Array.isArray(arr)) {
        return arr.map((it) => {
          if (!it) return null;
          if (typeof it === 'string') return { code: it, qty: 1 };
          if (typeof it === 'object' && it.code) return { code: String(it.code), qty: Number(it.qty) || 1 };
          return null;
        }).filter(Boolean);
      }
    } catch {}
  }
  return fallbackSingle ? [{ code: fallbackSingle, qty: 1 }] : [];
}

const cLineStmt   = db.prepare('SELECT product_id, qty AS combo_qty FROM combo_lines WHERE combo_id = ?');
const matLineStmt = db.prepare('SELECT material_code, qty FROM product_lines WHERE product_id = ?');

// 展开套餐在某渠道的主路径物料用量(不含替换品),返回 Map<item_code, qty>
function rollupMainBom(combo, channel) {
  const bom = new Map();
  const add = (code, qty) => {
    if (!code || qty <= 0) return;
    bom.set(code, (bom.get(code) || 0) + qty);
  };
  for (const cl of cLineStmt.all(combo.id)) {
    for (const m of matLineStmt.all(cl.product_id)) add(m.material_code, m.qty * cl.combo_qty);
  }
  const isTo = channel === 'takeout';
  for (const e of parseEntries(isTo ? combo.packaging_takeout_codes : combo.packaging_dinein_codes,
                               isTo ? combo.packaging_takeout_code  : combo.packaging_dinein_code)) add(e.code, e.qty);
  for (const e of parseEntries(isTo ? combo.sauce_takeout_codes : combo.sauce_dinein_codes,
                               isTo ? combo.sauce_takeout_code  : combo.sauce_dinein_code)) add(e.code, e.qty);
  return bom;
}

// 某渠道成本明细;matByCode: Map<item_code, materialRow>
export function comboChannelCost(combo, channel, matByCode) {
  const bom = rollupMainBom(combo, channel);
  let cost = 0;
  const missing = [];
  const breakdown = [];
  for (const [code, qty] of bom) {
    const mat = matByCode.get(code);
    const unit = materialUnitCost(mat);
    if (unit == null) { missing.push(code); continue; }
    const lineCost = unit * qty;
    cost += lineCost;
    breakdown.push({ item_code: code, qty, unit_cost: unit, line_cost: lineCost });
  }
  return { cost, missing, breakdown };
}

export function marginPct(price, cost) {
  if (price == null || price === 0) return null;
  return (price - cost) / price;
}

// 一个套餐的堂食/外卖两套成本+毛利;售价回退:渠道价 → 旧 price → null
export function comboMargins(combo, matByCode) {
  const build = (channel, price) => {
    const { cost, missing, breakdown } = comboChannelCost(combo, channel, matByCode);
    return { price, cost, margin: marginPct(price, cost), complete: missing.length === 0, missing, breakdown };
  };
  const priceTo = combo.price_takeout ?? combo.price ?? null;
  const priceDi = combo.price_dinein  ?? combo.price ?? null;
  return { takeout: build('takeout', priceTo), dinein: build('dinein', priceDi) };
}

// 一次性载入全部物料为 Map,供批量计算
export function loadMaterialMap() {
  const rows = db.prepare('SELECT item_code, item_name, uom, internal_price, price_includes_tax, tax_rate FROM materials').all();
  return new Map(rows.map((m) => [m.item_code, m]));
}
