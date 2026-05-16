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

-- BOM 替换:单品 BOM 行的物料替换 (主物料在 product_lines,替换品在这里)
CREATE TABLE IF NOT EXISTS product_line_substitutes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_line_id INTEGER NOT NULL REFERENCES product_lines(id) ON DELETE CASCADE,
  material_code  TEXT NOT NULL REFERENCES materials(item_code),
  qty            REAL NOT NULL DEFAULT 1,
  priority       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_pls_parent ON product_line_substitutes(parent_line_id);

-- BOM 替换:套餐内单品的替换 (主单品在 combo_lines,替换单品在这里)
CREATE TABLE IF NOT EXISTS combo_line_substitutes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_line_id INTEGER NOT NULL REFERENCES combo_lines(id) ON DELETE CASCADE,
  product_id     INTEGER NOT NULL REFERENCES products(id),
  qty            INTEGER NOT NULL DEFAULT 1,
  priority       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_cls_parent ON combo_line_substitutes(parent_line_id);

-- 订单级共享 BOM:整单 1 份触发的物料 (大袋/小票/筷子等)
-- channel=NULL 任何订单触发;'takeout' 仅外卖订单(订单含至少一个外卖套餐)触发;'dinein' 同理
-- 旧设计(单条 + 替换):弃用,新代码不再读写
CREATE TABLE IF NOT EXISTS order_shared_boms (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  material_code TEXT NOT NULL REFERENCES materials(item_code),
  qty           REAL NOT NULL DEFAULT 1,
  channel       TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS order_shared_bom_substitutes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id       INTEGER NOT NULL REFERENCES order_shared_boms(id) ON DELETE CASCADE,
  material_code   TEXT    NOT NULL REFERENCES materials(item_code),
  qty             REAL    NOT NULL DEFAULT 1,
  priority        INTEGER NOT NULL DEFAULT 1
);

-- 新设计:订单级共享 BOM 组 (外卖共有 / 到店共有 / 通用共有 等固定组)
-- 每组按单品 BOM 配置方式:N 行物料,每行可挂替换品
CREATE TABLE IF NOT EXISTS shared_bom_groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT UNIQUE NOT NULL,        -- 'takeout' / 'dinein' / 'all' 等固定 key
  name        TEXT NOT NULL,
  channel     TEXT,                         -- 'takeout' / 'dinein' / NULL=任何订单
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS shared_bom_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id      INTEGER NOT NULL REFERENCES shared_bom_groups(id) ON DELETE CASCADE,
  material_code TEXT    NOT NULL REFERENCES materials(item_code),
  qty           REAL    NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_sbl_group ON shared_bom_lines(group_id);
CREATE TABLE IF NOT EXISTS shared_bom_line_substitutes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_line_id  INTEGER NOT NULL REFERENCES shared_bom_lines(id) ON DELETE CASCADE,
  material_code   TEXT    NOT NULL REFERENCES materials(item_code),
  qty             REAL    NOT NULL DEFAULT 1,
  priority        INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_sbls_parent ON shared_bom_line_substitutes(parent_line_id);
`);

// Seed 固定的 3 个组
function seedSharedBomGroups() {
  const groups = [
    { code: 'takeout', name: '外卖共有', channel: 'takeout' },
    { code: 'dinein',  name: '到店共有', channel: 'dinein' },
    { code: 'all',     name: '通用共有', channel: null },
  ];
  const ins = db.prepare(`INSERT OR IGNORE INTO shared_bom_groups(code, name, channel) VALUES (?, ?, ?)`);
  for (const g of groups) ins.run(g.code, g.name, g.channel);
}
seedSharedBomGroups();

// Migrate combos to support multiple packaging/sauce per channel via JSON-array TEXT columns.
// Old single-code columns 保留用于向后兼容,新代码只读写 *_codes 字段。
function ensureColumn(table, col, def) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); }
  catch (e) { /* column already exists */ }
}
ensureColumn('combos', 'packaging_takeout_codes', 'TEXT');
ensureColumn('combos', 'packaging_dinein_codes',  'TEXT');
ensureColumn('combos', 'sauce_takeout_codes',     'TEXT');
ensureColumn('combos', 'sauce_dinein_codes',      'TEXT');
// 三语名称: name 字段当作中文主名,加英文/泰文
ensureColumn('products', 'name_en', 'TEXT');
ensureColumn('products', 'name_th', 'TEXT');
ensureColumn('combos',   'name_en', 'TEXT');
ensureColumn('combos',   'name_th', 'TEXT');

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
