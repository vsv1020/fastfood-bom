import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.BOM_DB || path.join(__dirname, 'data.sqlite');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS materials (
  item_code   TEXT PRIMARY KEY,
  item_name   TEXT NOT NULL,
  uom         TEXT,
  category    TEXT NOT NULL DEFAULT 'raw',  -- raw | packaging | sauce
  channel     TEXT,                          -- null | takeout | dinein  (only for packaging/sauce)
  source      TEXT NOT NULL DEFAULT 'manual',-- erp | manual
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  material_code TEXT    NOT NULL REFERENCES materials(item_code),
  qty           REAL    NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS combos (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  code                    TEXT UNIQUE NOT NULL,
  name                    TEXT NOT NULL,
  description             TEXT,
  packaging_takeout_code  TEXT REFERENCES materials(item_code),
  packaging_dinein_code   TEXT REFERENCES materials(item_code),
  sauce_takeout_code      TEXT REFERENCES materials(item_code),
  sauce_dinein_code       TEXT REFERENCES materials(item_code),
  created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS combo_lines (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  combo_id   INTEGER NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`);

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings(key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}
