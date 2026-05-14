import { Router } from 'express';
import { db } from '../db.js';

export const materialsRouter = Router();

materialsRouter.get('/', (req, res) => {
  const { category, channel, q } = req.query;
  const where = [];
  const params = [];
  if (category) { where.push('category = ?'); params.push(category); }
  if (channel)  { where.push('channel  = ?'); params.push(channel); }
  if (q)        { where.push('(item_code LIKE ? OR item_name LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  const sql = `SELECT * FROM materials ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY category, item_name`;
  res.json(db.prepare(sql).all(...params));
});

materialsRouter.post('/', (req, res) => {
  const { item_code, item_name, uom, category = 'raw', channel = null, source = 'manual' } = req.body || {};
  if (!item_code || !item_name) return res.status(400).json({ error: 'item_code and item_name required' });
  if (!['raw', 'packaging', 'sauce'].includes(category)) return res.status(400).json({ error: 'invalid category' });
  if (channel && !['takeout', 'dinein'].includes(channel)) return res.status(400).json({ error: 'invalid channel' });
  try {
    db.prepare(
      `INSERT INTO materials(item_code, item_name, uom, category, channel, source)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(item_code, item_name, uom || null, category, channel, source);
    res.json(db.prepare('SELECT * FROM materials WHERE item_code = ?').get(item_code));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

materialsRouter.put('/:item_code', (req, res) => {
  const { item_code } = req.params;
  const { item_name, uom, category, channel } = req.body || {};
  const existing = db.prepare('SELECT * FROM materials WHERE item_code = ?').get(item_code);
  if (!existing) return res.status(404).json({ error: 'not found' });
  db.prepare(
    `UPDATE materials SET
       item_name = COALESCE(?, item_name),
       uom       = COALESCE(?, uom),
       category  = COALESCE(?, category),
       channel   = ?,
       updated_at = datetime('now')
     WHERE item_code = ?`
  ).run(
    item_name ?? null,
    uom ?? null,
    category ?? null,
    channel === undefined ? existing.channel : channel,
    item_code
  );
  res.json(db.prepare('SELECT * FROM materials WHERE item_code = ?').get(item_code));
});

materialsRouter.delete('/:item_code', (req, res) => {
  db.prepare('DELETE FROM materials WHERE item_code = ?').run(req.params.item_code);
  res.json({ ok: true });
});

// Auto-classify ERP raw materials into packaging / sauce based on name keywords.
// Only touches rows where source='erp' AND category='raw' (so user's manual edits stay).
//
// POST /api/materials/auto-classify              -> apply
// POST /api/materials/auto-classify?dry_run=1    -> preview only
const SAUCE_INCLUDE = /酱|sauce|ซอส|น้ำจิ้ม|จัว|ฟิลลิ่ง|ครีมสลัด|ท๊อปปิ้งแยม|ketchup|mayo|mustard|มัสตาร์ด|มายอง|ซอสพริก|果酱/i;
// 容器/工具命名里含 "酱" 字,但本体是包材或厨具,不应归到酱料
const SAUCE_EXCLUDE_CONTAINER = /酱瓶|酱料盒|酱料分配器|挤酱瓶|sauce bottle|sauce dispenser|sauce box|sauce cup|ขวดซอส|ที่ใส่ซอส|ถ้วยซอส|กล่องซอส|with .*sauce|with .*mala/i;
// 一次性包材常见词
const PKG_KW = /袋|盒|杯|盖|纸盒|纸袋|纸杯|餐盒|餐袋|手提袋|打包|外卖盒|外卖袋|塑料盒|塑料盖|包装|垃圾袋|cup|bag|box|wrap|container|lid|tray|ฝา(?!น)|ถุง|กล่อง|ถาด|ถ้วย|ห่อ|ฟิลม์ซีล/i;
// 名字含包材词但本体是厨房工具 / PPE / 设备的
// 注意: 这里不再排除 "酱" — sauce 判断在前,残留进来的含"酱"项(如"酱料盒")就是包材
const PKG_EXCLUDE = /漏勺|滴油盘|急救箱|手机|插座|隔油|滤油|腌制机|面粉箱|垃圾桶|压力箱|工具箱|药箱|橡胶手套|塑料盆|塑料罐|杯架|防水袋|手套|带勺|围裙|抹布|拖把/i;

function classifyName(name) {
  if (!name) return null;
  if (SAUCE_INCLUDE.test(name) && !SAUCE_EXCLUDE_CONTAINER.test(name)) return 'sauce';
  if (PKG_KW.test(name) && !PKG_EXCLUDE.test(name)) return 'packaging';
  return null;
}

materialsRouter.post('/auto-classify', (req, res) => {
  const dryRun = req.query.dry_run === '1' || req.body?.dry_run === true;

  const rows = db.prepare(`
    SELECT item_code, item_name FROM materials
    WHERE source = 'erp' AND category = 'raw'
  `).all();

  const moves = { sauce: [], packaging: [] };
  for (const r of rows) {
    const target = classifyName(r.item_name);
    if (target) moves[target].push({ item_code: r.item_code, item_name: r.item_name });
  }

  if (!dryRun) {
    const upd = db.prepare(`UPDATE materials SET category = ?, updated_at = datetime('now') WHERE item_code = ?`);
    const tx = db.transaction(() => {
      for (const r of moves.sauce)     upd.run('sauce',     r.item_code);
      for (const r of moves.packaging) upd.run('packaging', r.item_code);
    });
    tx();
  }

  res.json({
    dry_run: !!dryRun,
    scanned: rows.length,
    sauce: { count: moves.sauce.length,     samples: moves.sauce.slice(0, 10),     items: dryRun ? moves.sauce : undefined },
    packaging: { count: moves.packaging.length, samples: moves.packaging.slice(0, 10), items: dryRun ? moves.packaging : undefined },
  });
});

// Dedupe: group by (lower(trim(item_name)), category); keep one per group,
// migrate references from the others, then delete them.
// Preference order: source='erp' > source='manual' (ERP wins so renamed items become canonical);
// within the same source, the lowest item_code wins (stable).
//
// POST /api/materials/dedupe              -> apply
// POST /api/materials/dedupe?dry_run=1    -> just report what would happen
materialsRouter.post('/dedupe', (req, res) => {
  const dryRun = req.query.dry_run === '1' || req.body?.dry_run === true;

  const groups = db.prepare(`
    SELECT lower(trim(item_name)) AS key, category, COUNT(*) AS n
    FROM materials
    WHERE item_name IS NOT NULL AND trim(item_name) != ''
    GROUP BY key, category
    HAVING n > 1
  `).all();

  const pickRows = db.prepare(`
    SELECT * FROM materials
    WHERE lower(trim(item_name)) = ? AND category = ?
  `);

  const actions = [];
  let removed = 0;
  let migrated = 0;

  const tx = db.transaction(() => {
    for (const g of groups) {
      const rows = pickRows.all(g.key, g.category);
      rows.sort((a, b) => {
        if (a.source === 'erp' && b.source !== 'erp') return -1;
        if (b.source === 'erp' && a.source !== 'erp') return 1;
        return a.item_code.localeCompare(b.item_code);
      });
      const keep = rows[0];
      const drops = rows.slice(1);
      const action = { name: rows[0].item_name, category: g.category, keep: keep.item_code, dropped: drops.map((d) => d.item_code) };
      actions.push(action);
      if (dryRun) continue;
      for (const r of drops) {
        const moved = [
          db.prepare('UPDATE product_lines SET material_code=? WHERE material_code=?').run(keep.item_code, r.item_code).changes,
          db.prepare('UPDATE combos SET packaging_takeout_code=? WHERE packaging_takeout_code=?').run(keep.item_code, r.item_code).changes,
          db.prepare('UPDATE combos SET packaging_dinein_code=?  WHERE packaging_dinein_code=?').run(keep.item_code, r.item_code).changes,
          db.prepare('UPDATE combos SET sauce_takeout_code=?     WHERE sauce_takeout_code=?').run(keep.item_code, r.item_code).changes,
          db.prepare('UPDATE combos SET sauce_dinein_code=?      WHERE sauce_dinein_code=?').run(keep.item_code, r.item_code).changes,
        ].reduce((a, b) => a + b, 0);
        migrated += moved;
        db.prepare('DELETE FROM materials WHERE item_code=?').run(r.item_code);
        removed++;
      }
    }
  });
  tx();

  res.json({ dry_run: !!dryRun, groups: groups.length, removed, refs_migrated: migrated, actions });
});

// Bulk import (for ERP sync or CSV paste)
materialsRouter.post('/bulk', (req, res) => {
  const items = Array.isArray(req.body) ? req.body : (req.body?.items || []);
  if (!items.length) return res.json({ inserted: 0, updated: 0 });
  const upsert = db.prepare(`
    INSERT INTO materials(item_code, item_name, uom, category, channel, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(item_code) DO UPDATE SET
      item_name  = excluded.item_name,
      uom        = excluded.uom,
      source     = excluded.source,
      updated_at = datetime('now')
  `);
  let n = 0;
  const tx = db.transaction(() => {
    for (const it of items) {
      if (!it.item_code || !it.item_name) continue;
      upsert.run(
        it.item_code,
        it.item_name,
        it.uom || null,
        it.category || 'raw',
        it.channel || null,
        it.source || 'erp'
      );
      n++;
    }
  });
  tx();
  res.json({ count: n });
});
