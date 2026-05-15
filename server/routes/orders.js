import { Router } from 'express';
import { db } from '../db.js';

export const ordersRouter = Router();

// 解析 JSON 字符串 / 旧字符串数组,统一返回 {code, qty}[]
function parseEntries(text, fallbackSingle) {
  if (text) {
    try {
      const arr = JSON.parse(text);
      if (Array.isArray(arr)) {
        return arr
          .map((it) => {
            if (!it) return null;
            if (typeof it === 'string') return { code: it, qty: 1 };
            if (typeof it === 'object' && it.code) return { code: String(it.code), qty: Number(it.qty) || 1 };
            return null;
          })
          .filter(Boolean);
      }
    } catch {}
  }
  return fallbackSingle ? [{ code: fallbackSingle, qty: 1 }] : [];
}

// POST /api/orders/preview
// body: { items: [{ kind: 'product'|'combo', id, qty, channel? }, ...] }
// 返回:items 详情 + 汇总 BOM (按 item_code+priority 合并;多个项的相同物料合并)
ordersRouter.post('/preview', (req, res) => {
  const items = (req.body && Array.isArray(req.body.items)) ? req.body.items : [];
  if (items.length === 0) {
    return res.json({ items: [], bom: [], total_lines: 0 });
  }

  // 累加器:key = `${code}|${priority}` -> { item_code, priority, qty }
  const bom = new Map();
  function add(code, qty, priority) {
    if (!code || qty <= 0) return;
    const key = `${code}|${priority}`;
    const cur = bom.get(key) || { item_code: code, priority, qty: 0 };
    cur.qty += qty;
    bom.set(key, cur);
  }

  // SQL 预编译
  const matLinesStmt = db.prepare('SELECT id, material_code, qty FROM product_lines WHERE product_id = ?');
  const matSubsStmt  = db.prepare('SELECT material_code, qty, priority FROM product_line_substitutes WHERE parent_line_id = ?');
  const cLineStmt    = db.prepare(`
    SELECT id, product_id, qty AS combo_qty FROM combo_lines WHERE combo_id = ?
  `);
  const cLineSubsStmt = db.prepare('SELECT product_id, qty AS combo_qty, priority FROM combo_line_substitutes WHERE parent_line_id = ?');
  const productMetaStmt = db.prepare('SELECT id, code, name FROM products WHERE id = ?');
  const comboStmt    = db.prepare('SELECT * FROM combos WHERE id = ?');

  // 展开一个 product 到 BOM,multiplier 是订单内倍数,outerPriority 沿链 max
  function expandProduct(productId, multiplier, outerPriority) {
    const mats = matLinesStmt.all(productId);
    for (const m of mats) {
      add(m.material_code, m.qty * multiplier, outerPriority);
      const subs = matSubsStmt.all(m.id);
      for (const s of subs) {
        add(s.material_code, s.qty * multiplier, Math.max(outerPriority, s.priority));
      }
    }
  }

  // 展开一个 combo 到 BOM
  function expandCombo(comboId, multiplier, channel) {
    const combo = comboStmt.get(comboId);
    if (!combo) return null;
    const cLines = cLineStmt.all(comboId);
    for (const cl of cLines) {
      expandProduct(cl.product_id, cl.combo_qty * multiplier, 0);
      const cSubs = cLineSubsStmt.all(cl.id);
      for (const cs of cSubs) {
        expandProduct(cs.product_id, cs.combo_qty * cl.combo_qty * multiplier, cs.priority);
      }
    }
    // 包材 / 酱料(按 channel)
    const ch = channel === 'dinein' ? 'dinein' : 'takeout';
    const pkgEntries = parseEntries(
      ch === 'takeout' ? combo.packaging_takeout_codes : combo.packaging_dinein_codes,
      ch === 'takeout' ? combo.packaging_takeout_code  : combo.packaging_dinein_code,
    );
    const sauceEntries = parseEntries(
      ch === 'takeout' ? combo.sauce_takeout_codes : combo.sauce_dinein_codes,
      ch === 'takeout' ? combo.sauce_takeout_code  : combo.sauce_dinein_code,
    );
    for (const e of pkgEntries)   add(e.code, e.qty * multiplier, 0);
    for (const e of sauceEntries) add(e.code, e.qty * multiplier, 0);
    return combo;
  }

  const itemsResolved = [];
  for (const it of items) {
    const qty = Number(it.qty) || 1;
    if (qty <= 0) continue;
    if (it.kind === 'product') {
      const p = productMetaStmt.get(Number(it.id));
      if (!p) { itemsResolved.push({ kind: 'product', id: it.id, qty, missing: true }); continue; }
      expandProduct(p.id, qty, 0);
      itemsResolved.push({ kind: 'product', id: p.id, code: p.code, name: p.name, qty });
    } else if (it.kind === 'combo') {
      const ch = it.channel === 'dinein' ? 'dinein' : 'takeout';
      const combo = expandCombo(Number(it.id), qty, ch);
      if (!combo) { itemsResolved.push({ kind: 'combo', id: it.id, qty, channel: ch, missing: true }); continue; }
      itemsResolved.push({ kind: 'combo', id: combo.id, code: combo.code, name: combo.name, qty, channel: ch });
    }
  }

  // 订单级共享 BOM:整单 1 份触发的物料
  // 收集订单含的渠道集合(只看套餐项)
  const channelsInOrder = new Set(
    itemsResolved.filter((x) => x.kind === 'combo' && !x.missing).map((x) => x.channel)
  );
  // 共享 BOM 组(新设计):每组按单品 BOM 模式配置 — N 行,每行可挂替换品
  // 命中规则:group.channel=NULL 总命中;'takeout'/'dinein' 视订单是否含对应渠道套餐
  const sharedGroups = db.prepare(`SELECT * FROM shared_bom_groups WHERE enabled = 1 ORDER BY id`).all();
  const sLineStmt = db.prepare(`SELECT id, material_code, qty FROM shared_bom_lines WHERE group_id = ?`);
  const sLineSubStmt = db.prepare(`SELECT material_code, qty, priority FROM shared_bom_line_substitutes WHERE parent_line_id = ?`);
  const sharedHits = [];
  const sharedCodesSet = new Set();
  const sharedSubCodes = new Set();
  for (const g of sharedGroups) {
    const matchChannel = !g.channel || channelsInOrder.has(g.channel);
    if (!matchChannel) continue;
    const lines = sLineStmt.all(g.id);
    if (lines.length === 0) continue;
    const groupHit = { group_id: g.id, code: g.code, name: g.name, channel: g.channel, lines: [] };
    for (const ln of lines) {
      add(ln.material_code, Number(ln.qty) || 1, 0);
      sharedCodesSet.add(ln.material_code);
      const subs = sLineSubStmt.all(ln.id);
      for (const sub of subs) {
        add(sub.material_code, Number(sub.qty) || 1, sub.priority);
        sharedSubCodes.add(sub.material_code);
      }
      groupHit.lines.push({ material_code: ln.material_code, qty: ln.qty, substitutes: subs });
    }
    sharedHits.push(groupHit);
  }
  const sharedCodes = sharedCodesSet;

  // Enrich
  const allCodes = [...new Set([...bom.values()].map((b) => b.item_code))];
  const meta = allCodes.length
    ? db.prepare(`SELECT * FROM materials WHERE item_code IN (${allCodes.map(() => '?').join(',')})`).all(...allCodes)
    : [];
  const metaByCode = new Map(meta.map((m) => [m.item_code, m]));
  const result = [...bom.values()]
    .map((b) => ({
      item_code: b.item_code,
      qty: b.qty,
      priority: b.priority,
      is_shared:
        (b.priority === 0 && sharedCodes.has(b.item_code)) ||
        (b.priority > 0 && sharedSubCodes.has(b.item_code)),
      ...(metaByCode.get(b.item_code) || { item_name: b.item_code }),
    }))
    .sort((a, b) =>
      a.priority - b.priority ||
      (a.category || '').localeCompare(b.category || '') ||
      a.item_name.localeCompare(b.item_name)
    );

  res.json({
    items: itemsResolved,
    bom: result,
    total_lines: result.length,
    shared_hits: sharedHits,
  });
});
