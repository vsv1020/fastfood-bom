import { Router } from 'express';
import { db } from '../db.js';

export const combosRouter = Router();

function nextComboCode() {
  const row = db.prepare(`
    SELECT MAX(CAST(SUBSTR(code, 3) AS INTEGER)) AS n
    FROM combos
    WHERE code GLOB 'C-[0-9]*'
  `).get();
  const next = (row?.n || 0) + 1;
  return `C-${String(next).padStart(4, '0')}`;
}

function parseCodes(text, fallbackSingle) {
  if (text) {
    try {
      const arr = JSON.parse(text);
      if (Array.isArray(arr)) return arr.filter(Boolean);
    } catch {}
  }
  return fallbackSingle ? [fallbackSingle] : [];
}

function loadCombo(id) {
  const c = db.prepare('SELECT * FROM combos WHERE id = ?').get(id);
  if (!c) return null;
  c.lines = db.prepare(`
    SELECT cl.id, cl.product_id, cl.qty,
           p.code AS product_code, p.name AS product_name
    FROM combo_lines cl
    JOIN products p ON p.id = cl.product_id
    WHERE cl.combo_id = ?
    ORDER BY cl.id
  `).all(id);
  // 把 JSON-array TEXT 解码成数组 (保留旧 *_code 单值为兼容)
  c.packaging_takeout_codes = parseCodes(c.packaging_takeout_codes, c.packaging_takeout_code);
  c.packaging_dinein_codes  = parseCodes(c.packaging_dinein_codes,  c.packaging_dinein_code);
  c.sauce_takeout_codes     = parseCodes(c.sauce_takeout_codes,     c.sauce_takeout_code);
  c.sauce_dinein_codes      = parseCodes(c.sauce_dinein_codes,      c.sauce_dinein_code);
  return c;
}

combosRouter.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM combo_lines cl WHERE cl.combo_id = c.id) AS line_count
    FROM combos c ORDER BY c.created_at DESC
  `).all();
  res.json(rows);
});

combosRouter.get('/:id', (req, res) => {
  const c = loadCombo(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'not found' });
  res.json(c);
});

// 接收数组或单值,标准化成 unique 数组,JSON.stringify 后落库
function normalizeCodes(arr, singleField) {
  if (Array.isArray(arr)) return [...new Set(arr.filter(Boolean).map(String))];
  if (typeof arr === 'string' && arr) return [arr];
  if (singleField) return [singleField];
  return [];
}

combosRouter.post('/', (req, res) => {
  const {
    code, name, description, lines = [],
    packaging_takeout_codes, packaging_dinein_codes,
    sauce_takeout_codes, sauce_dinein_codes,
    // backwards-compat 旧字段
    packaging_takeout_code, packaging_dinein_code,
    sauce_takeout_code, sauce_dinein_code,
  } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const finalCode = (code && code.trim()) ? code.trim() : nextComboCode();
  const pkgTo = normalizeCodes(packaging_takeout_codes, packaging_takeout_code);
  const pkgDi = normalizeCodes(packaging_dinein_codes,  packaging_dinein_code);
  const sauTo = normalizeCodes(sauce_takeout_codes,     sauce_takeout_code);
  const sauDi = normalizeCodes(sauce_dinein_codes,      sauce_dinein_code);
  try {
    const tx = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO combos(code, name, description,
          packaging_takeout_codes, packaging_dinein_codes,
          sauce_takeout_codes, sauce_dinein_codes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        finalCode, name, description || null,
        JSON.stringify(pkgTo), JSON.stringify(pkgDi),
        JSON.stringify(sauTo), JSON.stringify(sauDi),
      );
      const insLine = db.prepare('INSERT INTO combo_lines(combo_id, product_id, qty) VALUES (?, ?, ?)');
      for (const ln of lines) {
        if (!ln.product_id) continue;
        insLine.run(info.lastInsertRowid, ln.product_id, Number(ln.qty) || 1);
      }
      return info.lastInsertRowid;
    });
    res.json(loadCombo(tx()));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

combosRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM combos WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const {
    code, name, description, lines,
    packaging_takeout_codes, packaging_dinein_codes,
    sauce_takeout_codes, sauce_dinein_codes,
    packaging_takeout_code, packaging_dinein_code,
    sauce_takeout_code, sauce_dinein_code,
  } = req.body || {};
  const pkgTo = normalizeCodes(packaging_takeout_codes, packaging_takeout_code);
  const pkgDi = normalizeCodes(packaging_dinein_codes,  packaging_dinein_code);
  const sauTo = normalizeCodes(sauce_takeout_codes,     sauce_takeout_code);
  const sauDi = normalizeCodes(sauce_dinein_codes,      sauce_dinein_code);
  try {
    const tx = db.transaction(() => {
      db.prepare(`UPDATE combos SET
          code = COALESCE(?, code),
          name = COALESCE(?, name),
          description = ?,
          packaging_takeout_codes = ?,
          packaging_dinein_codes  = ?,
          sauce_takeout_codes     = ?,
          sauce_dinein_codes      = ?
        WHERE id = ?`)
        .run(
          code ?? null, name ?? null, description ?? null,
          JSON.stringify(pkgTo), JSON.stringify(pkgDi),
          JSON.stringify(sauTo), JSON.stringify(sauDi),
          id
        );
      if (Array.isArray(lines)) {
        db.prepare('DELETE FROM combo_lines WHERE combo_id = ?').run(id);
        const insLine = db.prepare('INSERT INTO combo_lines(combo_id, product_id, qty) VALUES (?, ?, ?)');
        for (const ln of lines) {
          if (!ln.product_id) continue;
          insLine.run(id, ln.product_id, Number(ln.qty) || 1);
        }
      }
    });
    tx();
    res.json(loadCombo(id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

combosRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM combos WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// Aggregate BOM for a combo at a given channel (takeout|dinein)
// Returns flat material list with qty rolled up across all included products,
// plus the chosen packaging + sauce for that channel.
combosRouter.get('/:id/bom', (req, res) => {
  const id = Number(req.params.id);
  const channel = req.query.channel === 'dinein' ? 'dinein' : 'takeout';
  const combo = db.prepare('SELECT * FROM combos WHERE id = ?').get(id);
  if (!combo) return res.status(404).json({ error: 'not found' });

  const lines = db.prepare(`
    SELECT cl.qty AS combo_qty, p.id AS product_id, p.code, p.name
    FROM combo_lines cl JOIN products p ON p.id = cl.product_id
    WHERE cl.combo_id = ?
  `).all(id);

  const bom = new Map();
  const add = (code, qty) => {
    if (!code) return;
    const cur = bom.get(code) || { qty: 0 };
    cur.qty += qty;
    bom.set(code, cur);
  };

  for (const ln of lines) {
    const matLines = db.prepare('SELECT material_code, qty FROM product_lines WHERE product_id = ?').all(ln.product_id);
    for (const m of matLines) add(m.material_code, m.qty * ln.combo_qty);
  }

  const pkgCodes = parseCodes(
    channel === 'takeout' ? combo.packaging_takeout_codes : combo.packaging_dinein_codes,
    channel === 'takeout' ? combo.packaging_takeout_code  : combo.packaging_dinein_code,
  );
  const sauceCodes = parseCodes(
    channel === 'takeout' ? combo.sauce_takeout_codes : combo.sauce_dinein_codes,
    channel === 'takeout' ? combo.sauce_takeout_code  : combo.sauce_dinein_code,
  );
  for (const c of pkgCodes)   add(c, 1);
  for (const c of sauceCodes) add(c, 1);

  // Enrich with material meta
  const codes = [...bom.keys()];
  const meta = codes.length
    ? db.prepare(`SELECT * FROM materials WHERE item_code IN (${codes.map(() => '?').join(',')})`).all(...codes)
    : [];
  const metaByCode = new Map(meta.map((m) => [m.item_code, m]));
  const result = codes
    .map((code) => ({
      item_code: code,
      qty: bom.get(code).qty,
      ...(metaByCode.get(code) || { item_name: code }),
    }))
    .sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.item_name.localeCompare(b.item_name));

  res.json({
    combo_id: id,
    channel,
    packaging_codes: pkgCodes,
    sauce_codes: sauceCodes,
    products: lines,
    bom: result,
  });
});
