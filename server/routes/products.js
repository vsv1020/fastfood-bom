import { Router } from 'express';
import { db } from '../db.js';

export const productsRouter = Router();

function nextProductCode() {
  const row = db.prepare(`
    SELECT MAX(CAST(SUBSTR(code, 3) AS INTEGER)) AS n
    FROM products
    WHERE code GLOB 'P-[0-9]*'
  `).get();
  const next = (row?.n || 0) + 1;
  return `P-${String(next).padStart(4, '0')}`;
}

function loadProduct(id) {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!p) return null;
  p.lines = db.prepare(`
    SELECT pl.id, pl.material_code, pl.qty,
           m.item_name, m.uom, m.category
    FROM product_lines pl
    LEFT JOIN materials m ON m.item_code = pl.material_code
    WHERE pl.product_id = ?
    ORDER BY pl.id
  `).all(id);
  // 每条 line 挂上替换品
  const subStmt = db.prepare(`
    SELECT s.id, s.material_code, s.qty, s.priority,
           m.item_name, m.uom, m.category
    FROM product_line_substitutes s
    LEFT JOIN materials m ON m.item_code = s.material_code
    WHERE s.parent_line_id = ?
    ORDER BY s.priority, s.id
  `);
  for (const ln of p.lines) ln.substitutes = subStmt.all(ln.id);
  return p;
}

productsRouter.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM product_lines pl WHERE pl.product_id = p.id) AS line_count
    FROM products p ORDER BY p.created_at DESC
  `).all();
  res.json(rows);
});

productsRouter.get('/:id', (req, res) => {
  const p = loadProduct(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(p);
});

productsRouter.post('/', (req, res) => {
  const { code, name, description, lines = [] } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const finalCode = (code && code.trim()) ? code.trim() : nextProductCode();
  try {
    const tx = db.transaction(() => {
      const info = db.prepare('INSERT INTO products(code, name, description) VALUES (?, ?, ?)')
        .run(finalCode, name, description || null);
      const insLine = db.prepare('INSERT INTO product_lines(product_id, material_code, qty) VALUES (?, ?, ?)');
      const insSub  = db.prepare('INSERT INTO product_line_substitutes(parent_line_id, material_code, qty, priority) VALUES (?, ?, ?, ?)');
      for (const ln of lines) {
        if (!ln.material_code) continue;
        const r = insLine.run(info.lastInsertRowid, ln.material_code, Number(ln.qty) || 1);
        for (const s of (ln.substitutes || [])) {
          if (!s.material_code) continue;
          insSub.run(r.lastInsertRowid, s.material_code, Number(s.qty) || 1, Number(s.priority) || 1);
        }
      }
      return info.lastInsertRowid;
    });
    const id = tx();
    res.json(loadProduct(id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

productsRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const { code, name, description, lines } = req.body || {};
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  try {
    const tx = db.transaction(() => {
      db.prepare(`UPDATE products SET
          code        = COALESCE(?, code),
          name        = COALESCE(?, name),
          description = ?
        WHERE id = ?`)
        .run(code ?? null, name ?? null, description ?? null, id);
      if (Array.isArray(lines)) {
        // DELETE 触发 FK CASCADE,会一并删 product_line_substitutes
        db.prepare('DELETE FROM product_lines WHERE product_id = ?').run(id);
        const insLine = db.prepare('INSERT INTO product_lines(product_id, material_code, qty) VALUES (?, ?, ?)');
        const insSub  = db.prepare('INSERT INTO product_line_substitutes(parent_line_id, material_code, qty, priority) VALUES (?, ?, ?, ?)');
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
    res.json(loadProduct(id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

productsRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});
