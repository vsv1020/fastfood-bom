import { Router } from 'express';
import * as XLSX from 'xlsx';
import { db } from '../db.js';
import { comboMargins, loadMaterialMap } from '../lib/cost.js';

export const exportRouter = Router();

// CSV escaping: 字段含 , " 换行 → 用 " 包裹,内部 " 转义为 ""
function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
function toCSV(headers, rows) {
  const head = headers.join(',');
  const body = rows.map((r) => headers.map((h) => csvEscape(r[h])).join(',')).join('\n');
  // BOM ﻿ for Excel UTF-8 detection
  return '﻿' + head + '\n' + body + '\n';
}
function send(res, name, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}_${Date.now()}.csv"`);
  // 禁止缓存:导出内容随数据实时变化,不能让浏览器/代理缓存旧响应
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.send(csv);
}

// 解析 ?folder_id= 导出范围:
//   未提供 / 空      -> null      (导出全部)
//   'ungrouped'      -> 'ungrouped'(仅未归类)
//   数字 id          -> [id, ...全部后代 folder id]  (该文件夹及子文件夹)
function folderScope(raw) {
  if (raw === undefined || raw === '') return null;
  if (raw === 'ungrouped') return 'ungrouped';
  const root = Number(raw);
  if (!Number.isFinite(root)) return null;
  const ids = new Set([root]);
  let frontier = [root];
  while (frontier.length) {
    const next = [];
    for (const fid of frontier) {
      for (const k of db.prepare('SELECT id FROM folders WHERE parent_id = ?').all(fid)) {
        if (!ids.has(k.id)) { ids.add(k.id); next.push(k.id); }
      }
    }
    frontier = next;
  }
  return [...ids];
}

// ---- 物料 ----
exportRouter.get('/materials.csv', (req, res) => {
  const rows = db.prepare(`
    SELECT item_code, item_name, uom, category, channel, source, updated_at
    FROM materials ORDER BY category, item_code
  `).all();
  const csv = toCSV(
    ['item_code', 'item_name', 'uom', 'category', 'channel', 'source', 'updated_at'],
    rows.map((r) => ({ ...r, channel: r.channel || '' }))
  );
  send(res, 'materials', csv);
});

// ---- BOM 单元 (产品 + 主物料 + 替换品 都扁平展开,priority 列区分) ----
exportRouter.get('/products.csv', (req, res) => {
  const out = [];
  const scope = folderScope(req.query.folder_id);
  let products;
  if (scope === null) {
    products = db.prepare(`SELECT id, code, name, name_en, name_th, description FROM products ORDER BY code`).all();
  } else if (scope === 'ungrouped') {
    products = db.prepare(`SELECT id, code, name, name_en, name_th, description FROM products WHERE folder_id IS NULL ORDER BY code`).all();
  } else {
    const ph = scope.map(() => '?').join(',');
    products = db.prepare(`SELECT id, code, name, name_en, name_th, description FROM products WHERE folder_id IN (${ph}) ORDER BY code`).all(...scope);
  }
  const lineStmt = db.prepare(`
    SELECT pl.id, pl.material_code, pl.qty, m.item_name, m.uom, m.category
    FROM product_lines pl LEFT JOIN materials m ON m.item_code = pl.material_code
    WHERE pl.product_id = ? ORDER BY pl.id
  `);
  const subStmt = db.prepare(`
    SELECT s.material_code, s.qty, s.priority, m.item_name, m.uom, m.category
    FROM product_line_substitutes s LEFT JOIN materials m ON m.item_code = s.material_code
    WHERE s.parent_line_id = ? ORDER BY s.priority, s.id
  `);
  for (const p of products) {
    const lines = lineStmt.all(p.id);
    if (lines.length === 0) {
      out.push({
        product_code: p.code, product_name: p.name,
        product_name_en: p.name_en || '', product_name_th: p.name_th || '',
        product_desc: p.description || '',
        line_role: '', priority: '', material_code: '', material_name: '', qty: '', uom: '', category: '',
      });
      continue;
    }
    for (const ln of lines) {
      out.push({
        product_code: p.code, product_name: p.name,
        product_name_en: p.name_en || '', product_name_th: p.name_th || '',
        product_desc: p.description || '',
        line_role: '主', priority: 0,
        material_code: ln.material_code, material_name: ln.item_name || '',
        qty: ln.qty, uom: ln.uom || '', category: ln.category || '',
      });
      const subs = subStmt.all(ln.id);
      for (const s of subs) {
        out.push({
          product_code: p.code, product_name: p.name,
        product_name_en: p.name_en || '', product_name_th: p.name_th || '',
        product_desc: p.description || '',
          line_role: '替换', priority: s.priority,
          material_code: s.material_code, material_name: s.item_name || '',
          qty: s.qty, uom: s.uom || '', category: s.category || '',
        });
      }
    }
  }
  const csv = toCSV(
    ['product_code', 'product_name', 'product_name_en', 'product_name_th', 'product_desc',
     'line_role', 'priority',
     'material_code', 'material_name', 'qty', 'uom', 'category'],
    out
  );
  send(res, 'bom_units', csv);
});

// ---- BOM 组合 (套餐扁平展开:每行一个 child product,主/替换 / 包装/酱料 列出) ----
exportRouter.get('/combos.csv', (req, res) => {
  const out = [];
  const matByCode = loadMaterialMap(); // 算成本/毛利用
  const scope = folderScope(req.query.folder_id);
  let combos;
  if (scope === null) {
    combos = db.prepare(`SELECT * FROM combos ORDER BY code`).all();
  } else if (scope === 'ungrouped') {
    combos = db.prepare(`SELECT * FROM combos WHERE folder_id IS NULL ORDER BY code`).all();
  } else {
    const ph = scope.map(() => '?').join(',');
    combos = db.prepare(`SELECT * FROM combos WHERE folder_id IN (${ph}) ORDER BY code`).all(...scope);
  }
  const lineStmt = db.prepare(`
    SELECT cl.id, cl.product_id, cl.qty, p.code, p.name, p.name_en, p.name_th
    FROM combo_lines cl JOIN products p ON p.id = cl.product_id
    WHERE cl.combo_id = ? ORDER BY cl.id
  `);
  const subStmt = db.prepare(`
    SELECT cs.product_id, cs.qty, cs.priority, p.code, p.name, p.name_en, p.name_th
    FROM combo_line_substitutes cs JOIN products p ON p.id = cs.product_id
    WHERE cs.parent_line_id = ? ORDER BY cs.priority, cs.id
  `);
  function parseEntries(text) {
    if (!text) return [];
    try { const a = JSON.parse(text); return Array.isArray(a) ? a : []; } catch { return []; }
  }
  function fmtEntries(entries) {
    return entries.map((e) => typeof e === 'string' ? e : `${e.code}×${e.qty}`).join(' | ');
  }
  for (const c of combos) {
    const lines = lineStmt.all(c.id);
    const pkgTo = fmtEntries(parseEntries(c.packaging_takeout_codes));
    const pkgDi = fmtEntries(parseEntries(c.packaging_dinein_codes));
    const sauceTo = fmtEntries(parseEntries(c.sauce_takeout_codes));
    const sauceDi = fmtEntries(parseEntries(c.sauce_dinein_codes));
    const mg = comboMargins(c, matByCode); // 该套餐堂食/外卖成本+毛利
    // 每个套餐按渠道展两段,行末附 channel 列;包装/酱料 + 成本/毛利率仅在所属渠道的主第一行显示
    for (const channel of ['takeout', 'dinein']) {
      const isTo = channel === 'takeout';
      const mc = mg[channel];
      const chCost = Math.round(mc.cost * 1000) / 1000;
      const chMargin = mc.margin == null ? '' : (Math.round(mc.margin * 10000) / 100) + '%';
      if (lines.length === 0) {
        out.push({
          combo_code: c.code, combo_name: c.name,
          combo_name_en: c.name_en || '', combo_name_th: c.name_th || '',
          combo_desc: c.description || '',
          line_role: '', priority: '',
          child_code: '', child_name: '', child_name_en: '', child_name_th: '', qty: '', uom: '',
          packaging_takeout: isTo ? pkgTo : '',
          packaging_dinein:  isTo ? '' : pkgDi,
          sauce_takeout:     isTo ? sauceTo : '',
          sauce_dinein:      isTo ? '' : sauceDi,
          channel,
          cost: chCost, margin_pct: chMargin,
        });
        continue;
      }
      let firstRow = true;
      for (const ln of lines) {
        out.push({
          combo_code: c.code, combo_name: c.name,
          combo_name_en: c.name_en || '', combo_name_th: c.name_th || '',
          combo_desc: c.description || '',
          line_role: '主', priority: 0,
          child_code: ln.code, child_name: ln.name,
          child_name_en: ln.name_en || '', child_name_th: ln.name_th || '',
          qty: ln.qty, uom: '份',
          packaging_takeout: firstRow && isTo  ? pkgTo   : '',
          packaging_dinein:  firstRow && !isTo ? pkgDi   : '',
          sauce_takeout:     firstRow && isTo  ? sauceTo : '',
          sauce_dinein:      firstRow && !isTo ? sauceDi : '',
          channel,
          cost:       firstRow ? chCost   : '',
          margin_pct: firstRow ? chMargin : '',
        });
        firstRow = false;
        for (const s of subStmt.all(ln.id)) {
          out.push({
            combo_code: c.code, combo_name: c.name,
            combo_name_en: c.name_en || '', combo_name_th: c.name_th || '',
            combo_desc: c.description || '',
            line_role: '替换', priority: s.priority,
            child_code: s.code, child_name: s.name,
            child_name_en: s.name_en || '', child_name_th: s.name_th || '',
            qty: s.qty, uom: '份',
            packaging_takeout: '', packaging_dinein: '', sauce_takeout: '', sauce_dinein: '',
            channel,
            cost: '', margin_pct: '',
          });
        }
      }
    }
  }
  const csv = toCSV(
    ['combo_code', 'combo_name', 'combo_name_en', 'combo_name_th', 'combo_desc',
     'line_role', 'priority',
     'child_code', 'child_name', 'child_name_en', 'child_name_th', 'qty', 'uom',
     'packaging_takeout', 'packaging_dinein', 'sauce_takeout', 'sauce_dinein',
     'channel', 'cost', 'margin_pct'],
    out
  );
  send(res, 'bom_combos', csv);
});

// ---- BOM 组合 → TTPOS 导入格式 (套餐展开到物料级 8 列;外卖 + 到店各一段) ----
exportRouter.get('/combo-bom.csv', (req, res) => {
  const scope = folderScope(req.query.folder_id);
  let combos;
  if (scope === null) {
    combos = db.prepare(`SELECT * FROM combos ORDER BY code`).all();
  } else if (scope === 'ungrouped') {
    combos = db.prepare(`SELECT * FROM combos WHERE folder_id IS NULL ORDER BY code`).all();
  } else {
    const ph = scope.map(() => '?').join(',');
    combos = db.prepare(`SELECT * FROM combos WHERE folder_id IN (${ph}) ORDER BY code`).all(...scope);
  }

  const matLinesStmt = db.prepare('SELECT id, material_code, qty FROM product_lines WHERE product_id = ?');
  const matSubsStmt  = db.prepare('SELECT material_code, qty, priority FROM product_line_substitutes WHERE parent_line_id = ?');
  const cLineStmt    = db.prepare('SELECT id, product_id, qty AS combo_qty FROM combo_lines WHERE combo_id = ?');
  const cLineSubsStmt= db.prepare('SELECT product_id, qty AS combo_qty, priority FROM combo_line_substitutes WHERE parent_line_id = ?');

  function parseEnt(text) {
    if (!text) return [];
    try {
      const a = JSON.parse(text);
      if (!Array.isArray(a)) return [];
      return a.map((it) => typeof it === 'string'
        ? { code: it, qty: 1 }
        : (it && it.code ? { code: String(it.code), qty: Number(it.qty) || 1 } : null)).filter(Boolean);
    } catch { return []; }
  }

  // 展开一个套餐在某渠道下的汇总物料 BOM,按 (item_code, priority) 累加
  function rollup(combo, channel) {
    const bom = new Map();
    const add = (code, qty, priority) => {
      if (!code || qty <= 0) return;
      const key = `${code}|${priority}`;
      const cur = bom.get(key) || { item_code: code, priority, qty: 0 };
      cur.qty += qty;
      bom.set(key, cur);
    };
    const expandProduct = (productId, multiplier, outerPriority) => {
      for (const m of matLinesStmt.all(productId)) {
        add(m.material_code, m.qty * multiplier, outerPriority);
        for (const s of matSubsStmt.all(m.id))
          add(s.material_code, s.qty * multiplier, Math.max(outerPriority, s.priority));
      }
    };
    for (const cl of cLineStmt.all(combo.id)) {
      expandProduct(cl.product_id, cl.combo_qty, 0);
      for (const cs of cLineSubsStmt.all(cl.id))
        expandProduct(cs.product_id, cs.combo_qty * cl.combo_qty, cs.priority);
    }
    for (const e of parseEnt(channel === 'takeout' ? combo.packaging_takeout_codes : combo.packaging_dinein_codes))
      add(e.code, e.qty, 0);
    for (const e of parseEnt(channel === 'takeout' ? combo.sauce_takeout_codes : combo.sauce_dinein_codes))
      add(e.code, e.qty, 0);
    return [...bom.values()];
  }

  // 套餐所属文件夹名 → 作为 TTPOS 的 product_category_name_en
  const folderName = new Map(db.prepare('SELECT id, name FROM folders').all().map((f) => [f.id, f.name]));

  // TTPOS 导入格式 8 列;外卖+到店各一段,替换品也展开成行
  const out = [];
  for (const c of combos) {
    const category = c.folder_id != null ? (folderName.get(c.folder_id) || '') : '';
    const productName = c.name_en || c.name;
    for (const channel of ['takeout', 'dinein']) {
      const rows = rollup(c, channel);
      if (rows.length === 0) continue;
      const codes = [...new Set(rows.map((r) => r.item_code))];
      const meta = db.prepare(
        `SELECT item_code, item_name, name_en, uom FROM materials WHERE item_code IN (${codes.map(() => '?').join(',')})`
      ).all(...codes);
      const metaByCode = new Map(meta.map((m) => [m.item_code, m]));
      rows.sort((a, b) => a.priority - b.priority || a.item_code.localeCompare(b.item_code));
      for (const r of rows) {
        const m = metaByCode.get(r.item_code) || {};
        out.push({
          product_category_name_en: category,
          product_name_en: productName,
          product_spec_name_en: 'pc',
          processing_servings: 1,
          material_name_en: m.name_en || m.item_name || r.item_code,
          material_code: r.item_code,
          material_unit_name_en: m.uom || '',
          material_qty: Math.round(r.qty * 1000) / 1000,
          channel,
        });
      }
    }
  }
  // 行内已含 channel,同套餐外卖/堂食保留为各自一段;同段内若有完全相同的行才合并
  const seen = new Set();
  const deduped = out.filter((row) => {
    const k = JSON.stringify(row);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const csv = toCSV(
    ['product_category_name_en', 'product_name_en', 'product_spec_name_en', 'processing_servings',
     'material_name_en', 'material_code', 'material_unit_name_en', 'material_qty', 'channel'],
    deduped
  );
  send(res, 'ttpos_combo_bom', csv);
});

// ---- BOM 组合 → TTPOS 完整导入模板 (12 列:三语名 + 单位/税/价格 + 物料级 BOM) ----
exportRouter.get('/combo-ttpos.csv', (req, res) => {
  const scope = folderScope(req.query.folder_id);
  let combos;
  if (scope === null) {
    combos = db.prepare(`SELECT * FROM combos ORDER BY code`).all();
  } else if (scope === 'ungrouped') {
    combos = db.prepare(`SELECT * FROM combos WHERE folder_id IS NULL ORDER BY code`).all();
  } else {
    const ph = scope.map(() => '?').join(',');
    combos = db.prepare(`SELECT * FROM combos WHERE folder_id IN (${ph}) ORDER BY code`).all(...scope);
  }

  const matLinesStmt = db.prepare('SELECT id, material_code, qty FROM product_lines WHERE product_id = ?');
  const matSubsStmt  = db.prepare('SELECT material_code, qty, priority FROM product_line_substitutes WHERE parent_line_id = ?');
  const cLineStmt    = db.prepare('SELECT id, product_id, qty AS combo_qty FROM combo_lines WHERE combo_id = ?');
  const cLineSubsStmt= db.prepare('SELECT product_id, qty AS combo_qty, priority FROM combo_line_substitutes WHERE parent_line_id = ?');

  function parseEnt(text) {
    if (!text) return [];
    try {
      const a = JSON.parse(text);
      if (!Array.isArray(a)) return [];
      return a.map((it) => typeof it === 'string'
        ? { code: it, qty: 1 }
        : (it && it.code ? { code: String(it.code), qty: Number(it.qty) || 1 } : null)).filter(Boolean);
    } catch { return []; }
  }
  function rollup(combo, channel) {
    const bom = new Map();
    const add = (code, qty, priority) => {
      if (!code || qty <= 0) return;
      const key = `${code}|${priority}`;
      const cur = bom.get(key) || { item_code: code, priority, qty: 0 };
      cur.qty += qty;
      bom.set(key, cur);
    };
    const expandProduct = (productId, multiplier, outerPriority) => {
      for (const m of matLinesStmt.all(productId)) {
        add(m.material_code, m.qty * multiplier, outerPriority);
        for (const s of matSubsStmt.all(m.id))
          add(s.material_code, s.qty * multiplier, Math.max(outerPriority, s.priority));
      }
    };
    for (const cl of cLineStmt.all(combo.id)) {
      expandProduct(cl.product_id, cl.combo_qty, 0);
      for (const cs of cLineSubsStmt.all(cl.id))
        expandProduct(cs.product_id, cs.combo_qty * cl.combo_qty, cs.priority);
    }
    for (const e of parseEnt(channel === 'takeout' ? combo.packaging_takeout_codes : combo.packaging_dinein_codes))
      add(e.code, e.qty, 0);
    for (const e of parseEnt(channel === 'takeout' ? combo.sauce_takeout_codes : combo.sauce_dinein_codes))
      add(e.code, e.qty, 0);
    return [...bom.values()];
  }

  const folderName = new Map(db.prepare('SELECT id, name FROM folders').all().map((f) => [f.id, f.name]));

  const out = [];
  for (const c of combos) {
    const base = {
      product_category_name_en: c.folder_id != null ? (folderName.get(c.folder_id) || '') : '',
      product_name_en: c.name_en || c.name,
      product_name_zh: c.name,
      product_name_th: c.name_th || '',
      unit_name_en: 'pc',
      tax_name_en: 'VAT',
      price: c.price == null ? '' : c.price,
    };
    let anyRow = false;
    for (const channel of ['takeout', 'dinein']) {
      const rows = rollup(c, channel);
      if (rows.length === 0) continue;
      anyRow = true;
      const codes = [...new Set(rows.map((r) => r.item_code))];
      const meta = db.prepare(
        `SELECT item_code, item_name, name_en, uom FROM materials WHERE item_code IN (${codes.map(() => '?').join(',')})`
      ).all(...codes);
      const metaByCode = new Map(meta.map((m) => [m.item_code, m]));
      rows.sort((a, b) => a.priority - b.priority || a.item_code.localeCompare(b.item_code));
      for (const r of rows) {
        const m = metaByCode.get(r.item_code) || {};
        out.push({
          ...base,
          processing_servings: 1,
          material_name_en: m.name_en || m.item_name || r.item_code,
          material_code: r.item_code,
          material_unit_name_en: m.uom || '',
          material_qty: Math.round(r.qty * 1000) / 1000,
          channel,
        });
      }
    }
    // 无 BOM 的套餐:仅输出一行产品级信息(物料列留空)
    if (!anyRow) {
      out.push({ ...base, processing_servings: '', material_name_en: '', material_code: '', material_unit_name_en: '', material_qty: '', channel: '' });
    }
  }
  // 行内已含 channel,同套餐外卖/堂食保留为各自一段
  const seen = new Set();
  const deduped = out.filter((row) => {
    const k = JSON.stringify(row);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const csv = toCSV(
    ['product_category_name_en', 'product_name_en', 'product_name_zh', 'product_name_th',
     'unit_name_en', 'tax_name_en', 'price', 'processing_servings',
     'material_name_en', 'material_code', 'material_unit_name_en', 'material_qty', 'channel'],
    deduped
  );
  send(res, 'ttpos_combo_full', csv);
});

// ---- 共享物料 (3 个固定组,每组多行 + 替换品) ----
exportRouter.get('/shared-boms.csv', (req, res) => {
  const out = [];
  const groups = db.prepare(`SELECT * FROM shared_bom_groups ORDER BY id`).all();
  const lineStmt = db.prepare(`
    SELECT l.id, l.material_code, l.qty, m.item_name, m.uom, m.category
    FROM shared_bom_lines l LEFT JOIN materials m ON m.item_code = l.material_code
    WHERE l.group_id = ? ORDER BY l.id
  `);
  const subStmt = db.prepare(`
    SELECT s.material_code, s.qty, s.priority, m.item_name, m.uom, m.category
    FROM shared_bom_line_substitutes s LEFT JOIN materials m ON m.item_code = s.material_code
    WHERE s.parent_line_id = ? ORDER BY s.priority, s.id
  `);
  for (const g of groups) {
    const lines = lineStmt.all(g.id);
    if (lines.length === 0) {
      out.push({
        group_code: g.code, group_name: g.name, group_channel: g.channel || 'all', enabled: g.enabled ? '是' : '否',
        line_role: '', priority: '', material_code: '', material_name: '', qty: '', uom: '', category: '',
      });
      continue;
    }
    for (const ln of lines) {
      out.push({
        group_code: g.code, group_name: g.name, group_channel: g.channel || 'all', enabled: g.enabled ? '是' : '否',
        line_role: '主', priority: 0,
        material_code: ln.material_code, material_name: ln.item_name || '',
        qty: ln.qty, uom: ln.uom || '', category: ln.category || '',
      });
      for (const s of subStmt.all(ln.id)) {
        out.push({
          group_code: g.code, group_name: g.name, group_channel: g.channel || 'all', enabled: g.enabled ? '是' : '否',
          line_role: '替换', priority: s.priority,
          material_code: s.material_code, material_name: s.item_name || '',
          qty: s.qty, uom: s.uom || '', category: s.category || '',
        });
      }
    }
  }
  const csv = toCSV(
    ['group_code', 'group_name', 'group_channel', 'enabled', 'line_role', 'priority',
     'material_code', 'material_name', 'qty', 'uom', 'category'],
    out
  );
  send(res, 'shared_boms', csv);
});

// ---- 毛利率 (每套餐 2 行:外卖 / 堂食;成本=含税单品成本×用量,毛利率=(售价−成本)/售价) ----
exportRouter.get('/margins.csv', (req, res) => {
  const matByCode = loadMaterialMap();
  const folderName = new Map(db.prepare('SELECT id, name FROM folders').all().map((f) => [f.id, f.name]));
  const scope = folderScope(req.query.folder_id);
  let combos;
  if (scope === null) combos = db.prepare('SELECT * FROM combos ORDER BY code').all();
  else if (scope === 'ungrouped') combos = db.prepare('SELECT * FROM combos WHERE folder_id IS NULL ORDER BY code').all();
  else { const ph = scope.map(() => '?').join(','); combos = db.prepare(`SELECT * FROM combos WHERE folder_id IN (${ph}) ORDER BY code`).all(...scope); }

  const matName = (code) => matByCode.get(code)?.item_name || code;
  const out = [];
  for (const c of combos) {
    const m = comboMargins(c, matByCode);
    const folder = c.folder_id != null ? (folderName.get(c.folder_id) || '') : '';
    for (const channel of ['takeout', 'dinein']) {
      const x = m[channel];
      out.push({
        '套餐编码': c.code,
        '套餐名称': c.name,
        '文件夹': folder,
        '渠道': channel === 'takeout' ? '外卖' : '堂食',
        '售价': x.price == null ? '' : x.price,
        '成本': Math.round(x.cost * 1000) / 1000,
        '毛利率': x.margin == null ? '' : (Math.round(x.margin * 10000) / 100) + '%',
        '数据完整': x.complete ? '是' : '否',
        '缺价物料': x.missing.map(matName).join(' | '),
      });
    }
  }
  const csv = toCSV(
    ['套餐编码', '套餐名称', '文件夹', '渠道', '售价', '成本', '毛利率', '数据完整', '缺价物料'],
    out
  );
  send(res, 'margins', csv);
});

// ---- 毛利明细 Excel(.xlsx,合并单元格)----
// 每个套餐 × 渠道 一个合并块:套餐名/渠道/成本合计/售价/毛利率 纵向合并跨该块物料行;
// 物料逐行展开(主路径 BOM,与成本口径一致),带 用量/单价(含税成本单价)/行成本。
exportRouter.get('/margins.xlsx', (req, res) => {
  const matByCode = loadMaterialMap();
  const scope = folderScope(req.query.folder_id);
  let combos;
  if (scope === null) combos = db.prepare('SELECT * FROM combos ORDER BY code').all();
  else if (scope === 'ungrouped') combos = db.prepare('SELECT * FROM combos WHERE folder_id IS NULL ORDER BY code').all();
  else { const ph = scope.map(() => '?').join(','); combos = db.prepare(`SELECT * FROM combos WHERE folder_id IN (${ph}) ORDER BY code`).all(...scope); }

  const header = ['套餐编码', '套餐名称', '渠道', '物料名称', '物料编码', '用量', '单位', '单价', '行成本', '成本合计', '售价', '毛利率'];
  const aoa = [header];
  const merges = [];
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const r4 = (x) => Math.round(x * 10000) / 10000;
  for (const c of combos) {
    const m = comboMargins(c, matByCode);
    for (const channel of ['takeout', 'dinein']) {
      const ch = m[channel];
      const bd = ch.breakdown.length ? ch.breakdown : [{ item_code: '', qty: '', unit_cost: '', line_cost: '' }];
      const startR = aoa.length;
      bd.forEach((b, i) => {
        const mat = b.item_code ? (matByCode.get(b.item_code) || {}) : {};
        aoa.push([
          i === 0 ? c.code : '',
          i === 0 ? c.name : '',
          i === 0 ? (channel === 'takeout' ? '外卖' : '堂食') : '',
          b.item_code ? (mat.item_name || b.item_code) : '',
          b.item_code,
          b.qty === '' ? '' : Number(b.qty),
          mat.uom || '',
          b.unit_cost === '' ? '' : r4(b.unit_cost),
          b.line_cost === '' ? '' : r3(b.line_cost),
          i === 0 ? r3(ch.cost) : '',
          i === 0 ? (ch.price == null ? '' : ch.price) : '',
          i === 0 ? (ch.margin == null ? '' : ch.margin) : '',
        ]);
      });
      const endR = aoa.length - 1;
      if (endR > startR) {
        for (const col of [0, 1, 2, 9, 10, 11]) merges.push({ s: { r: startR, c: col }, e: { r: endR, c: col } });
      }
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges;
  ws['!cols'] = [{ wch: 10 }, { wch: 24 }, { wch: 6 }, { wch: 22 }, { wch: 12 },
    { wch: 8 }, { wch: 6 }, { wch: 9 }, { wch: 9 }, { wch: 10 }, { wch: 8 }, { wch: 9 }];
  // 数字格式:金额 2 位、毛利率百分比
  const numFmt = { 5: '0.00', 7: '0.00', 8: '0.00', 9: '0.00', 10: '0.00', 11: '0.00%' };
  for (let R = 1; R < aoa.length; R++) {
    for (const cStr of Object.keys(numFmt)) {
      const C = Number(cStr);
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && typeof cell.v === 'number') cell.z = numFmt[C];
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '套餐毛利');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="combo_margins_${Date.now()}.xlsx"`);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.send(buf);
});
