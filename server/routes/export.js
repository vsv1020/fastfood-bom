import { Router } from 'express';
import { db } from '../db.js';

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
    if (lines.length === 0) {
      out.push({
        combo_code: c.code, combo_name: c.name,
        combo_name_en: c.name_en || '', combo_name_th: c.name_th || '',
        combo_desc: c.description || '',
        line_role: '', priority: '',
        child_code: '', child_name: '', child_name_en: '', child_name_th: '', qty: '', uom: '',
        packaging_takeout: pkgTo, packaging_dinein: pkgDi,
        sauce_takeout: sauceTo, sauce_dinein: sauceDi,
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
        // 把套餐级配置只在主单品的第一行显示一次
        packaging_takeout: firstRow ? pkgTo : '',
        packaging_dinein: firstRow ? pkgDi : '',
        sauce_takeout: firstRow ? sauceTo : '',
        sauce_dinein: firstRow ? sauceDi : '',
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
        });
      }
    }
  }
  const csv = toCSV(
    ['combo_code', 'combo_name', 'combo_name_en', 'combo_name_th', 'combo_desc',
     'line_role', 'priority',
     'child_code', 'child_name', 'child_name_en', 'child_name_th', 'qty', 'uom',
     'packaging_takeout', 'packaging_dinein', 'sauce_takeout', 'sauce_dinein'],
    out
  );
  send(res, 'bom_combos', csv);
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
