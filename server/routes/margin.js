import { Router } from 'express';
import { db } from '../db.js';
import { comboMargins, loadMaterialMap } from '../lib/cost.js';

export const marginRouter = Router();

// 解析 ?folder_id= 范围(同 export.js):未提供=全部, 'ungrouped'=未归类, 数字=该文件夹及子孙
function folderScope(raw) {
  if (raw === undefined || raw === '') return null;
  if (raw === 'ungrouped') return 'ungrouped';
  const root = Number(raw);
  if (!Number.isFinite(root)) return null;
  const ids = new Set([root]);
  let frontier = [root];
  while (frontier.length) {
    const next = [];
    for (const fid of frontier)
      for (const k of db.prepare('SELECT id FROM folders WHERE parent_id = ?').all(fid))
        if (!ids.has(k.id)) { ids.add(k.id); next.push(k.id); }
    frontier = next;
  }
  return [...ids];
}

function selectCombos(scope) {
  if (scope === null) return db.prepare('SELECT * FROM combos ORDER BY code').all();
  if (scope === 'ungrouped') return db.prepare('SELECT * FROM combos WHERE folder_id IS NULL ORDER BY code').all();
  const ph = scope.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM combos WHERE folder_id IN (${ph}) ORDER BY code`).all(...scope);
}

// GET /api/margin?folder_id= → 每个套餐的堂食/外卖成本 + 毛利率
marginRouter.get('/', (req, res) => {
  const matByCode = loadMaterialMap();
  // 实际在用的税率(去重),含税口径来自各物料 ERP Item Tax Template / custom_tax
  const ratesInUse = [...new Set([...matByCode.values()].map((m) => Number(m.tax_rate) || 0))].sort((a, b) => a - b);
  const folderName = new Map(db.prepare('SELECT id, name FROM folders').all().map((f) => [f.id, f.name]));
  const combos = selectCombos(folderScope(req.query.folder_id));
  const matName = (c) => matByCode.get(c)?.item_name || c;
  const rows = combos.map((c) => {
    const m = comboMargins(c, matByCode);
    const fmt = (x) => ({
      price: x.price,
      cost: Math.round(x.cost * 1000) / 1000,
      margin: x.margin == null ? null : Math.round(x.margin * 10000) / 10000,
      complete: x.complete,
      missing: x.missing.map((code) => ({ item_code: code, item_name: matName(code) })),
    });
    return {
      combo_id: c.id, code: c.code, name: c.name,
      folder: c.folder_id != null ? (folderName.get(c.folder_id) || '') : '',
      takeout: fmt(m.takeout), dinein: fmt(m.dinein),
    };
  });
  res.json({
    markup: 0.05,
    tax_rates_in_use: ratesInUse,
    tax_source: 'ERP Item Tax Template / custom_tax',
    count: rows.length,
    combos: rows,
  });
});

// GET /api/margin/combo/:id → 单个套餐的堂食/外卖成本(供「BOM 组合」编辑器实时算毛利)
// 售价不在这里算(编辑器用实时输入框的值),只回成本 + 缺价物料
marginRouter.get('/combo/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM combos WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'combo not found' });
  const matByCode = loadMaterialMap();
  const matName = (code) => matByCode.get(code)?.item_name || code;
  const m = comboMargins(c, matByCode);
  const fmt = (x) => ({
    cost: Math.round(x.cost * 1000) / 1000,
    complete: x.complete,
    missing: x.missing.map((code) => ({ item_code: code, item_name: matName(code) })),
  });
  res.json({ combo_id: c.id, markup: 0.05, takeout: fmt(m.takeout), dinein: fmt(m.dinein) });
});
