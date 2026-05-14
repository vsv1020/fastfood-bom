import { useEffect, useState } from 'react';
import { Save, RefreshCw, KeyRound } from 'lucide-react';
import { api } from '../api';

export default function SettingsPage() {
  const [url, setUrl] = useState('https://erp-victor.ttpos.dev');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [secretSet, setSecretSet] = useState(false);
  const [itemGroup, setItemGroup] = useState('Raw Material');
  const [nameField, setNameField] = useState('custom_item_name_zh');
  const [whitelist, setWhitelist] = useState('');
  const [whitelistStrict, setWhitelistStrict] = useState(false);
  const [whitelistCount, setWhitelistCount] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  async function load() {
    const s = await api.getErpSettings();
    setUrl(s.url || 'https://erp-victor.ttpos.dev');
    setApiKey(s.api_key || '');
    setSecretSet(s.api_secret_set);
    setItemGroup(s.item_group || 'Raw Material');
    setNameField(s.name_field || 'custom_item_name_zh');
    setWhitelist(s.whitelist || '');
    setWhitelistCount(s.whitelist_count || 0);
    setWhitelistStrict(!!s.whitelist_strict);
  }
  useEffect(() => { load(); }, []);

  async function save() {
    setSaving(true); setMsg(null);
    try {
      await api.saveErpSettings({
        url: url.trim(),
        api_key: apiKey.trim(),
        api_secret: apiSecret.trim() || undefined,
        item_group: itemGroup.trim(),
        name_field: nameField.trim() || 'custom_item_name_zh',
        whitelist,
        whitelist_strict: whitelistStrict,
      });
      setApiSecret('');
      await load();
      flash('保存成功');
    } catch (e: any) {
      flash('保存失败: ' + e.message);
    } finally { setSaving(false); }
  }

  async function sync() {
    setSyncing(true); setMsg(null);
    try {
      const r = await api.syncErp();
      const parts = [`写入 ${r.count} 条`, `名称字段=${r.name_field}`];
      if (r.whitelist_used) parts.push(`白名单=${r.whitelist_size}`);
      if (!r.name_field_used && r.name_field_requested !== 'item_name') {
        parts.push(`(ERP 未返回 ${r.name_field_requested},退回 item_name)`);
      }
      if (r.name_missing > 0) parts.push(`${r.name_missing} 条缺中文名`);
      if (r.strict_mode) {
        parts.push(`严格模式: 清理 ${r.strict_purged} 条`);
        if (r.strict_blocked.length > 0) {
          parts.push(`${r.strict_blocked.length} 条被 BOM 引用跳过 (${r.strict_blocked.slice(0,3).map(b=>b.item_code).join(', ')}${r.strict_blocked.length>3?'...':''})`);
        }
      }
      if (r.note) parts.push(r.note);
      flash(`同步成功: ${parts.join(' · ')}`);
    } catch (e: any) {
      flash('同步失败: ' + e.message);
    } finally { setSyncing(false); }
  }

  function flash(s: string) {
    setMsg(s);
    setTimeout(() => setMsg(null), 5000);
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">设置</h1>
        <p className="text-sm text-slate-500 mt-1">
          配置 ERPNext 连接,从指定 Item Group 同步 Raw Material 物料到本地物料库。
        </p>
      </header>

      {msg && (
        <div className="mb-4 rounded-lg bg-brand-50 border border-brand-100 text-brand-700 px-4 py-2 text-sm">
          {msg}
        </div>
      )}

      <div className="card p-6 space-y-4">
        <div className="flex items-center gap-2 text-slate-900 font-semibold">
          <KeyRound size={16} /> ERPNext / Frappe 连接
        </div>

        <div>
          <label className="label">ERP URL</label>
          <input className="input mt-1" value={url} onChange={(e) => setUrl(e.target.value)}
                 placeholder="https://erp-victor.ttpos.dev" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">API Key</label>
            <input className="input mt-1 font-mono" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                   placeholder="例如 abcd1234..." />
          </div>
          <div>
            <label className="label">
              API Secret {secretSet && <span className="text-emerald-600 normal-case font-normal">· 已保存</span>}
            </label>
            <input type="password" className="input mt-1 font-mono"
                   value={apiSecret} onChange={(e) => setApiSecret(e.target.value)}
                   placeholder={secretSet ? '留空表示不修改' : '输入 API secret'} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Item Group</label>
            <input className="input mt-1" value={itemGroup} onChange={(e) => setItemGroup(e.target.value)}
                   placeholder="Raw Material" />
            <p className="text-[11px] text-slate-400 mt-1">
              只同步该 Item Group 下、未禁用的 Item。
            </p>
          </div>
          <div>
            <label className="label">中文名称字段</label>
            <input className="input mt-1 font-mono" value={nameField}
                   onChange={(e) => setNameField(e.target.value)}
                   placeholder="custom_item_name_zh" />
            <p className="text-[11px] text-slate-400 mt-1">
              ERPNext「Item Name (ZH)」对应的字段名。若该字段不存在,自动退回 <code>item_name</code>。
            </p>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100">
          <label className="label flex items-center justify-between">
            <span>Item Code 白名单 <span className="text-slate-400 normal-case font-normal">(可选)</span></span>
            <span className="font-mono text-[10px] text-slate-400 normal-case tracking-normal">
              已解析 {(whitelist || '').split(/[\s,;]+/).filter((s) => s && !s.startsWith('#')).length} 个 unique code
              {whitelistCount !== undefined ? ` · 上次保存 ${whitelistCount}` : ''}
            </span>
          </label>
          <textarea
            className="input mt-1 font-mono text-xs min-h-[120px] resize-y"
            value={whitelist}
            onChange={(e) => setWhitelist(e.target.value)}
            placeholder="一行一个 item_code,也支持逗号/分号/空格分隔。可加 #注释。&#10;&#10;例:&#10;PA99001&#10;BE01004 # 百事可乐&#10;SA01002, SA01003, SA01004"
          />
          <div className="mt-2 flex items-center gap-2 text-[12px]">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={whitelistStrict}
                onChange={(e) => setWhitelistStrict(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-300"
              />
              <span className="font-medium text-slate-700">严格模式</span>
            </label>
            <span className="text-slate-400">
              · 启用后,同步结束自动删除 source=erp 且不在白名单内的物料(被 BOM 引用的跳过)。留空白名单 = 退回按 Item Group 全量同步。
            </span>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-outline" onClick={sync} disabled={syncing}>
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? '同步中…' : '立即同步'}
          </button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            <Save size={14} /> 保存
          </button>
        </div>
      </div>

      <div className="card p-6 mt-4 text-sm text-slate-600 space-y-2">
        <h3 className="font-semibold text-slate-900">使用流程</h3>
        <ol className="list-decimal ml-5 space-y-1">
          <li>在「设置」填入 ERP URL + API key/secret + Item Group → 保存 → 立即同步</li>
          <li>「物料库」中按需补充 包材 / 酱料,并标记 外卖 / 到店</li>
          <li>「单品 BOM」拖动原材料,组成最小单元的单品 (如:芝士牛肉堡)</li>
          <li>「套餐组合」拖单品组合套餐,选择 外卖+到店 的包材/酱料,系统自动汇总 BOM</li>
        </ol>
      </div>
    </div>
  );
}
