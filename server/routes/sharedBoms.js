import { Router } from 'express';
import { db } from '../db.js';

export const sharedBomsRouter = Router();

const linesStmt = db.prepare(`
  SELECT l.id, l.material_code, l.qty,
         m.item_name, m.uom, m.category
  FROM shared_bom_lines l
  LEFT JOIN materials m ON m.item_code = l.material_code
  WHERE l.group_id = ?
  ORDER BY l.id
`);
const subStmt = db.prepare(`
  SELECT s.id, s.material_code, s.qty, s.priority,
         m.item_name, m.uom, m.category
  FROM shared_bom_line_substitutes s
  LEFT JOIN materials m ON m.item_code = s.material_code
  WHERE s.parent_line_id = ?
  ORDER BY s.priority, s.id
`);

function loadGroup(g) {
  const lines = linesStmt.all(g.id);
  for (const ln of lines) ln.substitutes = subStmt.all(ln.id);
  return { ...g, lines };
}

sharedBomsRouter.get('/', (req, res) => {
  const groups = db.prepare(`SELECT * FROM shared_bom_groups ORDER BY id`).all();
  res.json(groups.map(loadGroup));
});

sharedBomsRouter.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const g = db.prepare(`SELECT * FROM shared_bom_groups WHERE id = ?`).get(id);
  if (!g) return res.status(404).json({ error: 'not found' });
  res.json(loadGroup(g));
});

// PUT 整组替换式更新:接收 { name?, enabled?, lines: [{material_code, qty, substitutes:[...]}] }
sharedBomsRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const g = db.prepare(`SELECT * FROM shared_bom_groups WHERE id = ?`).get(id);
  if (!g) return res.status(404).json({ error: 'not found' });
  const { name, enabled, lines } = req.body || {};
  try {
    const tx = db.transaction(() => {
      if (name !== undefined || enabled !== undefined) {
        db.prepare(`
          UPDATE shared_bom_groups
          SET name = COALESCE(?, name),
              enabled = COALESCE(?, enabled)
          WHERE id = ?
        `).run(
          name ?? null,
          enabled === undefined ? null : (enabled ? 1 : 0),
          id
        );
      }
      if (Array.isArray(lines)) {
        // CASCADE 会一并删 substitutes
        db.prepare(`DELETE FROM shared_bom_lines WHERE group_id = ?`).run(id);
        const insLine = db.prepare(`INSERT INTO shared_bom_lines(group_id, material_code, qty) VALUES (?, ?, ?)`);
        const insSub  = db.prepare(`INSERT INTO shared_bom_line_substitutes(parent_line_id, material_code, qty, priority) VALUES (?, ?, ?, ?)`);
        for (const ln of lines) {
          if (!ln.material_code) continue;
          const r = insLine.run(id, ln.material_code, Number(ln.qty) || 1);
          for (const s of (ln.substitutes || [])) {
            if (!s.material_code) continue;
            insSub.run(r.lastInsertRowid, s.material_code, Number(s.qty) || 1, Number(s.priority) || 1);
          }
        }
      }
    });
    tx();
    const updated = db.prepare(`SELECT * FROM shared_bom_groups WHERE id = ?`).get(id);
    res.json(loadGroup(updated));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
