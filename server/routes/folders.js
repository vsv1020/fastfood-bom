import { Router } from 'express';
import { db } from '../db.js';

export const foldersRouter = Router();

// 收集某 folder 的全部后代 folder id (用于防环 / 删除)
function descendantIds(id) {
  const out = new Set();
  let frontier = [id];
  while (frontier.length) {
    const next = [];
    for (const fid of frontier) {
      for (const k of db.prepare('SELECT id FROM folders WHERE parent_id = ?').all(fid)) {
        if (!out.has(k.id)) { out.add(k.id); next.push(k.id); }
      }
    }
    frontier = next;
  }
  return out;
}

// 列出某 kind 的全部 folder (扁平,前端建树)
foldersRouter.get('/', (req, res) => {
  const kind = req.query.kind === 'combo' ? 'combo' : 'product';
  res.json(db.prepare('SELECT * FROM folders WHERE kind = ? ORDER BY name').all(kind));
});

foldersRouter.post('/', (req, res) => {
  const { kind, name, parent_id } = req.body || {};
  const k = kind === 'combo' ? 'combo' : 'product';
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
  if (parent_id != null) {
    const p = db.prepare('SELECT kind FROM folders WHERE id = ?').get(parent_id);
    if (!p) return res.status(400).json({ error: 'parent not found' });
    if (p.kind !== k) return res.status(400).json({ error: 'parent kind mismatch' });
  }
  const info = db.prepare('INSERT INTO folders(kind, name, parent_id) VALUES (?, ?, ?)')
    .run(k, String(name).trim(), parent_id ?? null);
  res.json(db.prepare('SELECT * FROM folders WHERE id = ?').get(info.lastInsertRowid));
});

foldersRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const { name, parent_id } = req.body || {};
  let newParent = existing.parent_id;
  if (parent_id !== undefined) {
    if (parent_id == null) {
      newParent = null;
    } else {
      const np = Number(parent_id);
      if (np === id) return res.status(400).json({ error: 'cannot nest into self' });
      const p = db.prepare('SELECT kind FROM folders WHERE id = ?').get(np);
      if (!p) return res.status(400).json({ error: 'parent not found' });
      if (p.kind !== existing.kind) return res.status(400).json({ error: 'parent kind mismatch' });
      if (descendantIds(id).has(np)) return res.status(400).json({ error: 'cannot nest into descendant' });
      newParent = np;
    }
  }
  const newName = (name != null && String(name).trim()) ? String(name).trim() : null;
  db.prepare('UPDATE folders SET name = COALESCE(?, name), parent_id = ? WHERE id = ?')
    .run(newName, newParent, id);
  res.json(db.prepare('SELECT * FROM folders WHERE id = ?').get(id));
});

foldersRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
  if (!existing) return res.json({ ok: true });
  const tx = db.transaction(() => {
    const all = [id, ...descendantIds(id)];
    const table = existing.kind === 'product' ? 'products' : 'combos';
    const ph = all.map(() => '?').join(',');
    // 先把该 folder 及其所有后代里的条目退回「未归类」(folder_id = NULL)
    db.prepare(`UPDATE ${table} SET folder_id = NULL WHERE folder_id IN (${ph})`).run(...all);
    // 删 folder;parent_id ON DELETE CASCADE 会连子 folder 一起删
    db.prepare('DELETE FROM folders WHERE id = ?').run(id);
  });
  tx();
  res.json({ ok: true });
});
