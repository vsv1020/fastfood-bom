import { useEffect, useState } from 'react';
import { Save, RefreshCw, KeyRound } from 'lucide-react';
import { api } from '../api';
import { useT } from '../i18n';

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
  const t = useT();

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
      const parts = [`写入 ${r.count} 条`];
      if (r.custom_fields_used) parts.push('中/英/泰三语名称已同步');
      if (r.whitelist_used) parts.push(`白名单=${r.whitelist_size}`);
      if (r.name_missing > 0) parts.push(`${r.name_missing} 条缺名称`);
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
    <div className="h-full overflow-y-auto">
    <div className="p-8 max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">{t('set.title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('set.subtitle')}</p>
      </header>

      {msg && (
        <div className="mb-4 rounded-lg bg-brand-50 border border-brand-100 text-brand-700 px-4 py-2 text-sm">
          {msg}
        </div>
      )}

      <div className="card p-6 space-y-4">
        <div className="flex items-center gap-2 text-slate-900 font-semibold">
          <KeyRound size={16} /> {t('set.erp_conn')}
        </div>

        <div>
          <label className="label">{t('set.url')}</label>
          <input className="input mt-1" value={url} onChange={(e) => setUrl(e.target.value)}
                 placeholder="https://erp.example.com" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">{t('set.api_key')}</label>
            <input className="input mt-1 font-mono" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                   placeholder="abcd1234..." />
          </div>
          <div>
            <label className="label">
              {t('set.api_secret')} {secretSet && <span className="text-emerald-600 normal-case font-normal">· {t('set.api_secret_saved')}</span>}
            </label>
            <input type="password" className="input mt-1 font-mono"
                   value={apiSecret} onChange={(e) => setApiSecret(e.target.value)}
                   placeholder={secretSet ? t('set.api_secret_placeholder_kept') : t('set.api_secret_placeholder_new')} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">{t('set.item_group')}</label>
            <input className="input mt-1" value={itemGroup} onChange={(e) => setItemGroup(e.target.value)}
                   placeholder="Raw Material" />
            <p className="text-[11px] text-slate-400 mt-1">{t('set.item_group_hint')}</p>
          </div>
          <div>
            <label className="label">{t('set.name_field')}</label>
            <input className="input mt-1 font-mono" value={nameField}
                   onChange={(e) => setNameField(e.target.value)}
                   placeholder="custom_item_name_zh" />
            <p className="text-[11px] text-slate-400 mt-1">{t('set.name_field_hint')}</p>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100">
          <label className="label flex items-center justify-between">
            <span>{t('set.whitelist_title')} <span className="text-slate-400 normal-case font-normal">({t('placeholder.optional')})</span></span>
            <span className="font-mono text-[10px] text-slate-400 normal-case tracking-normal">
              {t('set.whitelist_parsed')} {(whitelist || '').split(/[\s,;]+/).filter((s) => s && !s.startsWith('#')).length} {t('set.whitelist_unique')}
              {whitelistCount !== undefined ? ` · ${t('set.whitelist_last')} ${whitelistCount}` : ''}
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
              <span className="font-medium text-slate-700">{t('set.strict_mode')}</span>
            </label>
            <span className="text-slate-400">· {t('set.strict_mode_hint')}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-outline" onClick={sync} disabled={syncing}>
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? t('set.syncing') : t('set.sync_now')}
          </button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            <Save size={14} /> {t('btn.save')}
          </button>
        </div>
      </div>

      <div className="card p-6 mt-4 text-sm text-slate-600 space-y-2">
        <h3 className="font-semibold text-slate-900">{t('set.usage_title')}</h3>
      </div>
    </div>
    </div>
  );
}
