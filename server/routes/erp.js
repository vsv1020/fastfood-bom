import { Router } from 'express';
import { db, getSetting, setSetting } from '../db.js';

export const erpRouter = Router();

// 把白名单文本(可换行/逗号/空格混合,支持 # 注释)解析成 unique code 数组
function parseWhitelist(text) {
  if (!text) return [];
  const set = new Set();
  for (const raw of text.split(/[\s,;]+/)) {
    const s = raw.trim();
    if (!s || s.startsWith('#')) continue;
    set.add(s);
  }
  return [...set];
}

// GET current ERP settings (mask the secret)
erpRouter.get('/settings', (req, res) => {
  const url = getSetting('erp_url') || 'https://erp-victor.ttpos.dev';
  const apiKey = getSetting('erp_api_key') || '';
  const apiSecret = getSetting('erp_api_secret') || '';
  const whitelistText = getSetting('erp_whitelist') || '';
  res.json({
    url,
    api_key: apiKey,
    api_secret_set: Boolean(apiSecret),
    item_group: getSetting('erp_item_group') || 'Raw Material',
    name_field: getSetting('erp_name_field') || 'custom_item_name_zh',
    whitelist: whitelistText,
    whitelist_count: parseWhitelist(whitelistText).length,
    whitelist_strict: getSetting('erp_whitelist_strict') === '1',
  });
});

erpRouter.put('/settings', (req, res) => {
  const { url, api_key, api_secret, item_group, name_field, whitelist, whitelist_strict } = req.body || {};
  if (url !== undefined) setSetting('erp_url', url);
  if (api_key !== undefined) setSetting('erp_api_key', api_key);
  if (api_secret !== undefined && api_secret !== '') setSetting('erp_api_secret', api_secret);
  if (item_group !== undefined) setSetting('erp_item_group', item_group);
  if (name_field !== undefined) setSetting('erp_name_field', name_field);
  if (whitelist !== undefined) setSetting('erp_whitelist', whitelist);
  if (whitelist_strict !== undefined) setSetting('erp_whitelist_strict', whitelist_strict ? '1' : '0');
  res.json({ ok: true });
});

// Sync items from Frappe/ERPNext
// Pulls Item where item_group = "Raw Material" and is_stock_item = 1, disabled = 0
erpRouter.post('/sync', async (req, res) => {
  const url = (getSetting('erp_url') || '').replace(/\/+$/, '');
  const apiKey = getSetting('erp_api_key');
  const apiSecret = getSetting('erp_api_secret');
  const itemGroup = getSetting('erp_item_group') || 'Raw Material';
  if (!url || !apiKey || !apiSecret) {
    return res.status(400).json({ error: '请先在「设置」页填入 ERP URL / API key / API secret' });
  }

  const nameField = (getSetting('erp_name_field') || 'custom_item_name_zh').trim();
  const whitelist = parseWhitelist(getSetting('erp_whitelist') || '');
  const strict = getSetting('erp_whitelist_strict') === '1';
  const filterClauses = [
    ['item_group', '=', itemGroup],
    ['disabled', '=', 0],
  ];
  if (whitelist.length > 0) filterClauses.push(['item_code', 'in', whitelist]);
  const filters = JSON.stringify(filterClauses);
  const baseFields = ['item_code', 'item_name', 'stock_uom', 'item_group'];
  // 中文名字段(可配置) + 泰文名字段(固定 custom_item_name_th);ERP 标准 item_name 作英文名
  const customFields = [...new Set([nameField, 'custom_item_name_th'].filter((f) => f && !baseFields.includes(f)))];

  async function fetchItems(includeCustom) {
    const fieldsArr = includeCustom ? [...baseFields, ...customFields] : baseFields;
    const endpoint = `${url}/api/resource/Item`
      + `?filters=${encodeURIComponent(filters)}`
      + `&fields=${encodeURIComponent(JSON.stringify(fieldsArr))}`
      + `&limit_page_length=0`;
    const r = await fetch(endpoint, {
      headers: {
        Authorization: `token ${apiKey}:${apiSecret}`,
        'Content-Type': 'application/json',
      },
    });
    if (!r.ok) {
      const text = await r.text();
      const err = new Error(`ERP HTTP ${r.status}: ${text.slice(0, 200)}`);
      err.status = r.status;
      throw err;
    }
    return r.json();
  }

  let payload;
  let usedCustom = false;
  try {
    if (customFields.length) {
      try {
        payload = await fetchItems(true);
        usedCustom = true;
      } catch (e) {
        // 自定义字段不存在时 Frappe 通常 417/500;降级到基础字段
        payload = await fetchItems(false);
      }
    } else {
      payload = await fetchItems(false);
    }
  } catch (e) {
    return res.status(502).json({ error: `请求 ERP 失败: ${e.message}` });
  }

  const list = payload?.data || [];
  if (!Array.isArray(list) || !list.length) {
    return res.json({ count: 0, items: [], note: 'ERP 返回空列表' });
  }

  // 选取本次 ERP 返回的 item_code 集合,用于清理本地"陈旧的 erp 行"
  const incomingCodes = new Set(list.map((it) => it.item_code).filter(Boolean));

  const upsert = db.prepare(`
    INSERT INTO materials(item_code, item_name, name_en, name_th, uom, category, channel, source, updated_at)
    VALUES (?, ?, ?, ?, ?, 'raw', NULL, 'erp', datetime('now'))
    ON CONFLICT(item_code) DO UPDATE SET
      item_name  = excluded.item_name,
      name_en    = excluded.name_en,
      name_th    = excluded.name_th,
      uom        = excluded.uom,
      source     = 'erp',
      updated_at = datetime('now')
  `);
  let n = 0;
  let nameMissing = 0;
  const tx = db.transaction(() => {
    for (const it of list) {
      if (!it.item_code) continue;
      // 中文名:优先配置的中文字段,退回 ERP item_name;英文名 = ERP 标准 item_name;泰文名 = custom_item_name_th
      const zh = (usedCustom && it[nameField]) || it.item_name || '';
      const en = it.item_name || '';
      const th = (usedCustom && it.custom_item_name_th) || '';
      if (!zh && !en) { nameMissing++; continue; }
      upsert.run(it.item_code, zh || en, en || null, th || null, it.stock_uom || null);
      n++;
    }
  });
  tx();

  // 严格白名单模式:同步成功后,删除 source='erp' 且 item_code 不在白名单内的物料。
  // 被 BOM 引用的物料 FK 会阻止删除,跳过并报告。
  let strictPurged = 0;
  const strictBlocked = [];
  if (strict && whitelist.length > 0) {
    const wlSet = new Set(whitelist);
    const erpRows = db.prepare(`SELECT item_code FROM materials WHERE source='erp'`).all();
    const toRemove = erpRows.map((r) => r.item_code).filter((c) => !wlSet.has(c));
    const del = db.prepare(`DELETE FROM materials WHERE item_code = ?`);
    for (const code of toRemove) {
      try { if (del.run(code).changes) strictPurged++; }
      catch (e) { strictBlocked.push({ item_code: code, reason: e.message }); }
    }
  }

  res.json({
    count: n,
    name_missing: nameMissing,
    custom_fields_used: usedCustom,
    whitelist_used: whitelist.length > 0,
    whitelist_size: whitelist.length,
    strict_mode: strict,
    strict_purged: strictPurged,
    strict_blocked: strictBlocked,
    note: usedCustom
      ? undefined
      : 'ERP 未返回自定义名称字段(中文/泰文),本次仅同步了 item_name(英文)',
  });
});

// 从当前 erp_url 配置的 ERP 拉「Selling - Internal」价目表,按 (item_code, materials.uom) 写 internal_price。
// 同时按 item 的 Item Tax Template 写 tax_rate,按 custom_tax(VAT Included)写 price_includes_tax(含税标记)。
erpRouter.post('/sync-prices', async (req, res) => {
  const url = (getSetting('erp_url') || '').replace(/\/+$/, '');
  const apiKey = getSetting('erp_api_key');
  const apiSecret = getSetting('erp_api_secret');
  const priceList = getSetting('price_list_name') || 'Selling - Internal';
  if (!url || !apiKey || !apiSecret) {
    return res.status(400).json({ error: '请先在「设置」页填入 ERP URL / API key / API secret' });
  }

  // 通用 ERP GET(返回 data 数组),doctype 路径自动编码(处理含空格的 Item Price 等)
  const auth = { Authorization: `token ${apiKey}:${apiSecret}`, 'Content-Type': 'application/json' };
  async function erpGet(doctype, fields, filters) {
    const ep = `${url}/api/resource/${encodeURIComponent(doctype)}`
      + `?fields=${encodeURIComponent(JSON.stringify(fields))}`
      + (filters ? `&filters=${encodeURIComponent(JSON.stringify(filters))}` : '')
      + `&limit_page_length=0`;
    const r = await fetch(ep, { headers: auth });
    if (!r.ok) { const t = await r.text(); const e = new Error(`HTTP ${r.status}: ${t.slice(0, 150)}`); e.status = r.status; throw e; }
    return (await r.json()).data || [];
  }
  // 单文档 GET(子表内嵌;生产 ERP 子表列表接口 403,只能逐个取全文档绕过)
  async function erpDoc(doctype, name) {
    const ep = `${url}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`;
    const r = await fetch(ep, { headers: auth });
    if (!r.ok) { const t = await r.text(); const e = new Error(`HTTP ${r.status}: ${t.slice(0, 150)}`); e.status = r.status; throw e; }
    return (await r.json()).data || {};
  }
  // 小并发池,避免逐个全文档串行太慢
  async function pool(items, size, fn) {
    const list = [...items];
    const it = list[Symbol.iterator]();
    await Promise.all(Array.from({ length: Math.min(size, list.length) }, async () => {
      for (let n = it.next(); !n.done; n = it.next()) await fn(n.value);
    }));
  }

  const mats = db.prepare('SELECT item_code, uom FROM materials').all();

  // 1) Selling-Internal 价
  let priceRows;
  try {
    priceRows = await erpGet('Item Price', ['item_code', 'uom', 'price_list_rate'], [['price_list', '=', priceList]]);
  } catch (e) {
    return res.status(502).json({ error: `拉取价目表失败: ${e.message}` });
  }
  const byCu = new Map(); // `${item_code}|${uom}` -> rate
  for (const it of priceRows) if (it.item_code && it.uom != null) byCu.set(`${it.item_code}|${it.uom}`, it.price_list_rate);

  // 2) 每物料的 Item Tax Template(税率) + custom_tax(是否含税)。
  //    生产 ERP 的子表列表(Item Tax / Item Tax Template Detail)接口 403,
  //    改为逐个 GET Item 全文档(内嵌 taxes 子表 + custom_tax),模板税率走 Item Tax Template 全文档。
  const tmplByItem = new Map(); // item_code -> template
  const rateByTmpl = new Map(); // template -> 小数税率
  const inclByItem = new Map(); // item_code -> 1/0 (custom_tax = VAT Included)
  let taxNote;
  let taxFail = 0;
  await pool(mats, 8, async (m) => {
    try {
      const doc = await erpDoc('Item', m.item_code);
      inclByItem.set(m.item_code, /included/i.test(doc.custom_tax || '') ? 1 : 0);
      const tmpl = (doc.taxes || []).map((t) => t.item_tax_template).find(Boolean);
      if (tmpl) tmplByItem.set(m.item_code, tmpl);
    } catch (e) { taxFail++; }
  });
  // 各模板税率:Item Tax Template 全文档的 taxes[].tax_rate 是百分数(0 / 7),转小数
  const tmpls = [...new Set([...tmplByItem.values()])];
  await pool(tmpls, 6, async (t) => {
    try {
      const doc = await erpDoc('Item Tax Template', t);
      const rate = (doc.taxes || []).map((x) => Number(x.tax_rate)).find((v) => Number.isFinite(v));
      rateByTmpl.set(t, (rate || 0) / 100);
    } catch (e) { rateByTmpl.set(t, 0); }
  });
  if (taxFail) taxNote = `${taxFail}/${mats.length} 个物料税率/含税读取失败(已按税率0、不含税处理)`;

  const upd = db.prepare(`UPDATE materials SET internal_price = ?, internal_price_uom = ?, tax_rate = ?, tax_template = ?, price_includes_tax = ?, price_synced_at = datetime('now') WHERE item_code = ?`);
  let matched = 0;
  const missing = [];
  const tx = db.transaction(() => {
    for (const m of mats) {
      const price = byCu.get(`${m.item_code}|${m.uom}`);
      if (price == null) { missing.push({ item_code: m.item_code, uom: m.uom }); continue; }
      const tmpl = tmplByItem.get(m.item_code) || null;
      const rate = tmpl ? (rateByTmpl.get(tmpl) || 0) : 0;
      const incl = inclByItem.get(m.item_code) || 0;
      upd.run(price, m.uom, rate, tmpl, incl, m.item_code);
      matched++;
    }
  });
  tx();

  const ratesInUse = [...new Set(mats.map((m) => {
    const t = tmplByItem.get(m.item_code); return t ? (rateByTmpl.get(t) || 0) : 0;
  }))].sort((a, b) => a - b);

  res.json({
    price_list: priceList,
    erp_rows: priceRows.length,
    local_materials: mats.length,
    matched,
    missing_count: missing.length,
    missing,
    tax_rates_in_use: ratesInUse,
    tax_note: taxNote,
  });
});
