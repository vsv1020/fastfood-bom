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

// 把 JSON 字符串解析为 {code, qty} 数组,兼容旧的 ["code1","code2"] 字符串数组(qty 默认 1)
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
// 旧 callers 兼容:返回纯 codes
function parseCodes(text, fallbackSingle) {
  return parseEntries(text, fallbackSingle).map((e) => e.code);
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
  // 每条 combo_line 挂上替换单品
  const subStmt = db.prepare(`
    SELECT s.id, s.product_id, s.qty, s.priority,
           p.code AS product_code, p.name AS product_name
    FROM combo_line_substitutes s
    JOIN products p ON p.id = s.product_id
    WHERE s.parent_line_id = ?
    ORDER BY s.priority, s.id
  `);
  for (const ln of c.lines) ln.substitutes = subStmt.all(ln.id);
  // 字段升级为 {code, qty}[] (兼容旧 ["code"] 数组与旧单值字段)
  c.packaging_takeout_codes = parseEntries(c.packaging_takeout_codes, c.packaging_takeout_code);
  c.packaging_dinein_codes  = parseEntries(c.packaging_dinein_codes,  c.packaging_dinein_code);
  c.sauce_takeout_codes     = parseEntries(c.sauce_takeout_codes,     c.sauce_takeout_code);
  c.sauce_dinein_codes      = parseEntries(c.sauce_dinein_codes,      c.sauce_dinein_code);
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

// 接收 {code,qty}[] 或 string[] 或单值,标准化成 unique {code,qty}[],JSON.stringify 后落库
function normalizeEntries(arr, singleField) {
  let raw;
  if (Array.isArray(arr)) raw = arr;
  else if (typeof arr === 'string' && arr) raw = [arr];
  else if (singleField) raw = [singleField];
  else return [];
  const map = new Map();
  for (const it of raw) {
    if (!it) continue;
    let code, qty;
    if (typeof it === 'string') { code = it; qty = 1; }
    else if (typeof it === 'object' && it.code) { code = String(it.code); qty = Number(it.qty) || 1; }
    else continue;
    map.set(code, qty); // 同 code 后写覆盖前(避免重复)
  }
  return [...map.entries()].map(([code, qty]) => ({ code, qty }));
}

combosRouter.post('/', (req, res) => {
  const {
    code, name, name_en, name_th, description, folder_id, lines = [],
    packaging_takeout_codes, packaging_dinein_codes,
    sauce_takeout_codes, sauce_dinein_codes,
    // backwards-compat 旧字段
    packaging_takeout_code, packaging_dinein_code,
    sauce_takeout_code, sauce_dinein_code,
  } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const finalCode = (code && code.trim()) ? code.trim() : nextComboCode();
  const pkgTo = normalizeEntries(packaging_takeout_codes, packaging_takeout_code);
  const pkgDi = normalizeEntries(packaging_dinein_codes,  packaging_dinein_code);
  const sauTo = normalizeEntries(sauce_takeout_codes,     sauce_takeout_code);
  const sauDi = normalizeEntries(sauce_dinein_codes,      sauce_dinein_code);
  try {
    const tx = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO combos(code, name, name_en, name_th, description, folder_id,
          packaging_takeout_codes, packaging_dinein_codes,
          sauce_takeout_codes, sauce_dinein_codes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        finalCode, name, name_en || null, name_th || null, description || null, folder_id ?? null,
        JSON.stringify(pkgTo), JSON.stringify(pkgDi),
        JSON.stringify(sauTo), JSON.stringify(sauDi),
      );
      const insLine = db.prepare('INSERT INTO combo_lines(combo_id, product_id, qty) VALUES (?, ?, ?)');
      const insSub  = db.prepare('INSERT INTO combo_line_substitutes(parent_line_id, product_id, qty, priority) VALUES (?, ?, ?, ?)');
      for (const ln of lines) {
        if (!ln.product_id) continue;
        const r = insLine.run(info.lastInsertRowid, ln.product_id, Number(ln.qty) || 1);
        for (const s of (ln.substitutes || [])) {
          if (!s.product_id) continue;
          insSub.run(r.lastInsertRowid, s.product_id, Number(s.qty) || 1, Number(s.priority) || 1);
        }
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
    code, name, name_en, name_th, description, folder_id, lines,
    packaging_takeout_codes, packaging_dinein_codes,
    sauce_takeout_codes, sauce_dinein_codes,
    packaging_takeout_code, packaging_dinein_code,
    sauce_takeout_code, sauce_dinein_code,
  } = req.body || {};
  const pkgTo = normalizeEntries(packaging_takeout_codes, packaging_takeout_code);
  const pkgDi = normalizeEntries(packaging_dinein_codes,  packaging_dinein_code);
  const sauTo = normalizeEntries(sauce_takeout_codes,     sauce_takeout_code);
  const sauDi = normalizeEntries(sauce_dinein_codes,      sauce_dinein_code);
  try {
    const tx = db.transaction(() => {
      db.prepare(`UPDATE combos SET
          code = COALESCE(?, code),
          name = COALESCE(?, name),
          name_en = ?,
          name_th = ?,
          description = ?,
          folder_id = ?,
          packaging_takeout_codes = ?,
          packaging_dinein_codes  = ?,
          sauce_takeout_codes     = ?,
          sauce_dinein_codes      = ?
        WHERE id = ?`)
        .run(
          code ?? null, name ?? null,
          name_en === undefined ? existing.name_en : (name_en || null),
          name_th === undefined ? existing.name_th : (name_th || null),
          description ?? null,
          folder_id === undefined ? existing.folder_id : (folder_id ?? null),
          JSON.stringify(pkgTo), JSON.stringify(pkgDi),
          JSON.stringify(sauTo), JSON.stringify(sauDi),
          id
        );
      if (Array.isArray(lines)) {
        // DELETE 触发 FK CASCADE,一并删 combo_line_substitutes
        db.prepare('DELETE FROM combo_lines WHERE combo_id = ?').run(id);
        const insLine = db.prepare('INSERT INTO combo_lines(combo_id, product_id, qty) VALUES (?, ?, ?)');
        const insSub  = db.prepare('INSERT INTO combo_line_substitutes(parent_line_id, product_id, qty, priority) VALUES (?, ?, ?, ?)');
        for (const ln of lines) {
          if (!ln.product_id) continue;
          const r = insLine.run(id, ln.product_id, Number(ln.qty) || 1);
          for (const s of (ln.substitutes || [])) {
            if (!s.product_id) continue;
            insSub.run(r.lastInsertRowid, s.product_id, Number(s.qty) || 1, Number(s.priority) || 1);
          }
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
    SELECT cl.id AS cl_id, cl.qty AS combo_qty, p.id AS product_id, p.code, p.name
    FROM combo_lines cl JOIN products p ON p.id = cl.product_id
    WHERE cl.combo_id = ?
  `).all(id);

  // BOM 按 (item_code, priority) 累加,主路径 priority=0,替换品 priority>=1
  // priority 沿链取 max:套餐替换 priority + 物料替换 priority 中较大的那个
  const bom = new Map(); // key = `${code}|${priority}` -> { code, priority, qty }
  function add(code, qty, priority) {
    if (!code || qty <= 0) return;
    const key = `${code}|${priority}`;
    const cur = bom.get(key) || { item_code: code, priority, qty: 0 };
    cur.qty += qty;
    bom.set(key, cur);
  }

  const matLinesStmt = db.prepare('SELECT id, material_code, qty FROM product_lines WHERE product_id = ?');
  const matSubsStmt  = db.prepare('SELECT material_code, qty, priority FROM product_line_substitutes WHERE parent_line_id = ?');
  const cLineSubsStmt = db.prepare('SELECT product_id, qty AS combo_qty, priority FROM combo_line_substitutes WHERE parent_line_id = ?');

  // 展开一个 product 的所有物料 (主路径 + 物料替换品),按倍数和外层 priority
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

  for (const ln of lines) {
    // 主单品
    expandProduct(ln.product_id, ln.combo_qty, 0);
    // 套餐内单品替换
    const cSubs = cLineSubsStmt.all(ln.cl_id);
    for (const cs of cSubs) {
      expandProduct(cs.product_id, cs.combo_qty * ln.combo_qty, cs.priority);
    }
  }

  // 包材 / 酱料 (priority=0 视为主选,数量取每条 entry.qty)
  const pkgEntries = parseEntries(
    channel === 'takeout' ? combo.packaging_takeout_codes : combo.packaging_dinein_codes,
    channel === 'takeout' ? combo.packaging_takeout_code  : combo.packaging_dinein_code,
  );
  const sauceEntries = parseEntries(
    channel === 'takeout' ? combo.sauce_takeout_codes : combo.sauce_dinein_codes,
    channel === 'takeout' ? combo.sauce_takeout_code  : combo.sauce_dinein_code,
  );
  for (const e of pkgEntries)   add(e.code, e.qty, 0);
  for (const e of sauceEntries) add(e.code, e.qty, 0);

  // Enrich with material meta
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
      ...(metaByCode.get(b.item_code) || { item_name: b.item_code }),
    }))
    .sort((a, b) =>
      a.priority - b.priority ||
      (a.category || '').localeCompare(b.category || '') ||
      a.item_name.localeCompare(b.item_name)
    );

  res.json({
    combo_id: id,
    channel,
    packaging_codes: pkgEntries.map((e) => e.code),  // 兼容字段
    sauce_codes:     sauceEntries.map((e) => e.code),
    packaging_entries: pkgEntries,
    sauce_entries:     sauceEntries,
    products: lines,
    bom: result,
  });
});
