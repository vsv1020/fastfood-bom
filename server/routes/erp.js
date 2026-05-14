import { Router } from 'express';
import { db, getSetting, setSetting } from '../db.js';

export const erpRouter = Router();

// GET current ERP settings (mask the secret)
erpRouter.get('/settings', (req, res) => {
  const url = getSetting('erp_url') || 'https://erp-victor.ttpos.dev';
  const apiKey = getSetting('erp_api_key') || '';
  const apiSecret = getSetting('erp_api_secret') || '';
  res.json({
    url,
    api_key: apiKey,
    api_secret_set: Boolean(apiSecret),
    item_group: getSetting('erp_item_group') || 'Raw Material',
    name_field: getSetting('erp_name_field') || 'custom_item_name_zh',
  });
});

erpRouter.put('/settings', (req, res) => {
  const { url, api_key, api_secret, item_group, name_field } = req.body || {};
  if (url !== undefined) setSetting('erp_url', url);
  if (api_key !== undefined) setSetting('erp_api_key', api_key);
  if (api_secret !== undefined && api_secret !== '') setSetting('erp_api_secret', api_secret);
  if (item_group !== undefined) setSetting('erp_item_group', item_group);
  if (name_field !== undefined) setSetting('erp_name_field', name_field);
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
  const filters = JSON.stringify([
    ['item_group', '=', itemGroup],
    ['disabled', '=', 0],
  ]);
  const baseFields = ['item_code', 'item_name', 'stock_uom', 'item_group'];
  const wantsCustomName = nameField && !baseFields.includes(nameField);

  async function fetchItems(includeNameField) {
    const fieldsArr = includeNameField ? [...baseFields, nameField] : baseFields;
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
  let usedNameField = false;
  try {
    if (wantsCustomName) {
      try {
        payload = await fetchItems(true);
        usedNameField = true;
      } catch (e) {
        // 字段不存在时 Frappe 通常 417/500;降级到基础字段
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
    INSERT INTO materials(item_code, item_name, uom, category, channel, source, updated_at)
    VALUES (?, ?, ?, 'raw', NULL, 'erp', datetime('now'))
    ON CONFLICT(item_code) DO UPDATE SET
      item_name  = excluded.item_name,
      uom        = excluded.uom,
      source     = 'erp',
      updated_at = datetime('now')
  `);
  let n = 0;
  let nameMissing = 0;
  const tx = db.transaction(() => {
    for (const it of list) {
      if (!it.item_code) continue;
      const name = (usedNameField && it[nameField]) || it.item_name;
      if (!name) { nameMissing++; continue; }
      if (usedNameField && !it[nameField]) nameMissing++;
      upsert.run(it.item_code, name, it.stock_uom || null);
      n++;
    }
  });
  tx();
  res.json({
    count: n,
    name_field: usedNameField ? nameField : 'item_name',
    name_field_requested: nameField,
    name_field_used: usedNameField,
    name_missing: nameMissing,
    note: usedNameField
      ? undefined
      : (wantsCustomName ? `ERP 没有字段 \`${nameField}\`,本次同步退回 item_name` : undefined),
  });
});
