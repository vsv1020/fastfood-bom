import { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Search, Trash2, Pencil, X, Check, Merge, Sparkles, Split, Download } from 'lucide-react';
import { api } from '../api';
import type { Material, Category, Channel } from '../types';
import { useT, useLang, materialName } from '../i18n';

// Tab keys 不包含 'other' — 未分类的物料仅出现在「全部」tab,不占独立 tab
type CategoryTabKey = 'all' | 'raw' | 'packaging' | 'sauce';
type Filter = { category: CategoryTabKey; channel: Channel | '' };

const CAT_LABELS: Record<CategoryTabKey, string> = {
  all: 'cat.all',
  raw: 'cat.raw',
  packaging: 'cat.packaging',
  sauce: 'cat.sauce',
};

function CategoryChip({ cat }: { cat: Category }) {
  const t = useT();
  if (cat === 'raw') return <span className="chip-raw">{t('cat.raw')}</span>;
  if (cat === 'packaging') return <span className="chip-pkg-to">{t('cat.packaging')}</span>;
  if (cat === 'sauce') return <span className="chip-sauce">{t('cat.sauce')}</span>;
  return <span className="chip bg-slate-100 text-slate-500">{t('cat.other')}</span>;
}

// 行内类别切换 — 点 chip-like select 直接改类别
function CategorySelect({ material, onChanged }: { material: Material; onChanged: () => void }) {
  const t = useT();
  const baseClass = 'appearance-none cursor-pointer rounded-full px-2 py-0.5 text-xs font-medium border focus:outline-none focus:ring-2 focus:ring-brand-200';
  const styleByCat: Record<Category, string> = {
    raw:       'bg-amber-50 text-amber-700 border-amber-100 hover:border-amber-300',
    packaging: 'bg-sky-50 text-sky-700 border-sky-100 hover:border-sky-300',
    sauce:     'bg-rose-50 text-rose-700 border-rose-100 hover:border-rose-300',
    other:     'bg-slate-100 text-slate-500 border-slate-200 hover:border-slate-300',
  };
  return (
    <select
      className={baseClass + ' ' + styleByCat[material.category]}
      value={material.category}
      title={t('lbl.category')}
      onChange={async (e) => {
        const newCat = e.target.value as Category;
        if (newCat === material.category) return;
        try {
          const clearChannel = newCat === 'raw' || newCat === 'other';
          await api.updateMaterial(material.item_code, {
            category: newCat,
            channel: clearChannel ? null : (material.channel ?? null),
          });
          onChanged();
        } catch (err: any) { alert(err.message); }
      }}
    >
      <option value="raw">{t('cat.raw')}</option>
      <option value="packaging">{t('cat.packaging')}</option>
      <option value="sauce">{t('cat.sauce')}</option>
      <option value="other">{t('cat.other')}</option>
    </select>
  );
}

function CategoryTab({ active, onClick, children, count }: {
  active: boolean; onClick: () => void; children: React.ReactNode; count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={
        'px-4 py-1.5 text-sm rounded-full transition flex items-center gap-1.5 ' +
        (active
          ? 'bg-brand-500 text-white shadow-sm'
          : 'bg-white border border-slate-200 text-slate-600 hover:border-brand-300 hover:text-brand-600')
      }
    >
      {children}
      {count != null && (
        <span className={
          'rounded-full px-1.5 text-[10px] ' +
          (active ? 'bg-white/20' : 'bg-slate-100 text-slate-500')
        }>{count}</span>
      )}
    </button>
  );
}

function ChannelChip({ channel }: { channel: Channel | null }) {
  const t = useT();
  if (channel === 'takeout') return <span className="chip-pkg-to">{t('chan.takeout')}</span>;
  if (channel === 'dinein')  return <span className="chip-pkg-di">{t('chan.dinein')}</span>;
  return <span className="chip bg-slate-100 text-slate-500">{t('chan.generic')}</span>;
}

export default function MaterialsPage() {
  const [filter, setFilter] = useState<Filter>({ category: 'all', channel: '' });
  const [items, setItems] = useState<Material[]>([]);
  const [counts, setCounts] = useState<Record<CategoryTabKey, number>>({ all: 0, raw: 0, packaging: 0, sauce: 0 });
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Material | 'new' | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState<Category | ''>('');
  const [bulkChan, setBulkChan] = useState<Channel | 'null' | ''>('');
  const t = useT();
  const { lang } = useLang();

  // 切换 tab / 渠道筛选 / 搜索时清空选择
  useEffect(() => { setSelected(new Set()); }, [filter.category, filter.channel, q]);

  async function load() {
    setLoading(true);
    try {
      const [list, raw, pkg, sauce, other] = await Promise.all([
        api.listMaterials({
          category: filter.category === 'all' ? undefined : filter.category,
          channel: filter.channel || undefined,
          q: q || undefined,
        }),
        api.listMaterials({ category: 'raw' }),
        api.listMaterials({ category: 'packaging' }),
        api.listMaterials({ category: 'sauce' }),
        api.listMaterials({ category: 'other' }),
      ]);
      setItems(list);
      setCounts({
        all: raw.length + pkg.length + sauce.length + other.length,
        raw: raw.length,
        packaging: pkg.length,
        sauce: sauce.length,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [filter, q]);

  async function onSync() {
    setSyncMsg('同步中…');
    try {
      const r = await api.syncErp();
      const parts = [`写入 ${r.count} 条原材料`];
      if (r.custom_fields_used) parts.push('已同步中/英/泰三语名称');
      if (r.name_missing > 0) parts.push(`${r.name_missing} 条缺名称`);
      if (r.note) parts.push(r.note);
      setSyncMsg(`同步成功: ${parts.join(' · ')}`);
      load();
    } catch (e: any) {
      setSyncMsg('同步失败: ' + e.message);
    }
    setTimeout(() => setSyncMsg(null), 8000);
  }

  async function onClassify() {
    setSyncMsg('扫描分类中…');
    try {
      const dry = await api.autoClassify(true);
      const sc = dry.sauce.count, pc = dry.packaging.count;
      if (sc + pc === 0) {
        setSyncMsg('没有发现可自动分类的物料 (所有 ERP raw 都不匹配 包材/酱料关键词)');
        setTimeout(() => setSyncMsg(null), 5000);
        return;
      }
      const previewS = dry.sauce.samples.slice(0, 5).map(x => `  ${x.item_code} ${x.item_name.split('|')[0].trim()}`).join('\n');
      const previewP = dry.packaging.samples.slice(0, 5).map(x => `  ${x.item_code} ${x.item_name.split('|')[0].trim()}`).join('\n');
      if (!confirm(
        `扫描了 ${dry.scanned} 条 ERP 原材料,将自动分类:\n\n` +
        `→ 酱料 ${sc} 条 (含):\n${previewS}${sc > 5 ? `\n  …还有 ${sc - 5} 条` : ''}\n\n` +
        `→ 包材 ${pc} 条 (含):\n${previewP}${pc > 5 ? `\n  …还有 ${pc - 5} 条` : ''}\n\n` +
        `只影响 source=erp 且当前为 raw 的物料。后续可在物料库逐条调整。\n\n确认执行?`
      )) {
        setSyncMsg(null);
        return;
      }
      const r = await api.autoClassify(false);
      setSyncMsg(`自动分类完成: 酱料 ${r.sauce.count} 条 · 包材 ${r.packaging.count} 条`);
      load();
    } catch (e: any) {
      setSyncMsg('分类失败: ' + e.message);
    }
    setTimeout(() => setSyncMsg(null), 6000);
  }

  async function onSplitChannel() {
    setSyncMsg('扫描渠道关键词中…');
    try {
      const dry = await api.splitChannel(true);
      const t = dry.takeout.count, d = dry.dinein.count, u = dry.untouched;
      if (t + d === 0) {
        setSyncMsg(`扫描 ${dry.scanned} 条 channel=NULL 包材/酱料,无法从名字识别外卖/到店,保持原状`);
        setTimeout(() => setSyncMsg(null), 6000);
        return;
      }
      const sampTo = dry.takeout.items.slice(0, 3).map(x => `  ${x.item_code} ${x.item_name.split('|')[0].trim()}`).join('\n');
      const sampDi = dry.dinein.items.slice(0, 3).map(x => `  ${x.item_code} ${x.item_name.split('|')[0].trim()}`).join('\n');
      if (!confirm(
        `扫描了 ${dry.scanned} 条无渠道的 ERP 包材/酱料:\n\n` +
        `→ 外卖 ${t} 条:\n${sampTo}${t > 3 ? `\n  …还有 ${t - 3} 条` : ''}\n\n` +
        `→ 到店 ${d} 条:\n${sampDi}${d > 3 ? `\n  …还有 ${d - 3} 条` : ''}\n\n` +
        `保留通用(无明显信号): ${u} 条\n\n确认执行?`
      )) {
        setSyncMsg(null);
        return;
      }
      const r = await api.splitChannel(false);
      setSyncMsg(`分流完成: 外卖 ${r.takeout.count} · 到店 ${r.dinein.count} · 保留通用 ${r.untouched}`);
      load();
    } catch (e: any) {
      setSyncMsg('分流失败: ' + e.message);
    }
    setTimeout(() => setSyncMsg(null), 6000);
  }

  async function onDedupe() {
    setSyncMsg('扫描重复中…');
    try {
      const dry = await api.dedupeMaterials(true);
      if (dry.groups === 0) {
        setSyncMsg('没有发现重复项 (按"名称+类别"判定)');
        setTimeout(() => setSyncMsg(null), 5000);
        return;
      }
      const preview = dry.actions.slice(0, 5)
        .map(a => `「${a.name}」保留 ${a.keep},删除 ${a.dropped.join(', ')}`)
        .join('\n');
      const more = dry.actions.length > 5 ? `\n…还有 ${dry.actions.length - 5} 组` : '';
      if (!confirm(
        `发现 ${dry.groups} 组重复 (按名称+类别),将删除 ${dry.actions.reduce((s,a)=>s+a.dropped.length,0)} 条,` +
        `保留优先级: source=erp > 字典序最小。\n\n预览:\n${preview}${more}\n\n确认执行?`
      )) {
        setSyncMsg(null);
        return;
      }
      const r = await api.dedupeMaterials(false);
      setSyncMsg(`去重完成: 删除 ${r.removed} 条 · 迁移 ${r.refs_migrated} 条 BOM 引用`);
      load();
    } catch (e: any) {
      setSyncMsg('去重失败: ' + e.message);
    }
    setTimeout(() => setSyncMsg(null), 6000);
  }

  function toggleOne(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  }
  function toggleAllVisible() {
    if (selected.size === items.length && items.length > 0) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.item_code)));
  }
  function clearSelection() { setSelected(new Set()); setBulkCat(''); setBulkChan(''); }

  async function applyBulk() {
    if (!bulkCat && bulkChan === '') {
      setSyncMsg('请先选择「→ 类别」或「→ 渠道」其中一项');
      setTimeout(() => setSyncMsg(null), 4000);
      return;
    }
    const updates: { category?: Category; channel?: Channel | null } = {};
    if (bulkCat) updates.category = bulkCat;
    if (bulkChan === 'null') updates.channel = null;
    else if (bulkChan) updates.channel = bulkChan;
    try {
      const r = await api.bulkUpdateMaterials([...selected], updates);
      setSyncMsg(`批量更新成功: 修改 ${r.updated} 条`);
      clearSelection();
      load();
    } catch (e: any) {
      setSyncMsg('批量更新失败: ' + e.message);
    }
    setTimeout(() => setSyncMsg(null), 5000);
  }

  async function bulkDelete() {
    if (!confirm(`删除选中的 ${selected.size} 条物料? 已被单品/套餐引用的会跳过`)) return;
    try {
      const r = await api.bulkDeleteMaterials([...selected]);
      const msg = `批量删除: 成功 ${r.deleted} 条`
        + (r.blocked.length > 0 ? ` · 被引用跳过 ${r.blocked.length} 条 (${r.blocked.slice(0,3).map(b=>b.item_code).join(', ')}${r.blocked.length>3?'...':''})` : '');
      setSyncMsg(msg);
      clearSelection();
      load();
    } catch (e: any) {
      setSyncMsg('批量删除失败: ' + e.message);
    }
    setTimeout(() => setSyncMsg(null), 8000);
  }

  async function onDelete(code: string) {
    if (!confirm(`删除 ${code}? 关联的 BOM 行可能受影响`)) return;
    await api.deleteMaterial(code);
    load();
  }

  const showChannelFilter = filter.category !== 'raw';

  return (
    <div className="h-full overflow-y-auto">
    <div className="p-8 max-w-7xl mx-auto">
      <header className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{t('mat.title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('mat.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <a className="btn-outline" href="/api/export/materials.csv" download title={t('btn.export')}>
            <Download size={14} /> {t('btn.export')}
          </a>
          <button className="btn-outline" onClick={onClassify}>
            <Sparkles size={14} /> {t('mat.btn_classify')}
          </button>
          <button className="btn-outline" onClick={onSplitChannel}>
            <Split size={14} /> {t('mat.btn_split')}
          </button>
          <button className="btn-outline" onClick={onDedupe}>
            <Merge size={14} /> {t('mat.btn_dedupe')}
          </button>
          <button className="btn-outline" onClick={onSync}>
            <RefreshCw size={14} /> {t('mat.btn_sync')}
          </button>
          <button className="btn-primary" onClick={() => setEditing('new')}>
            <Plus size={14} /> {t('mat.btn_add')}
          </button>
        </div>
      </header>

      {syncMsg && (
        <div className="mb-4 rounded-lg bg-brand-50 border border-brand-100 text-brand-700 px-4 py-2 text-sm">
          {syncMsg}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {(Object.keys(CAT_LABELS) as CategoryTabKey[]).map((c) => (
          <CategoryTab
            key={c}
            active={filter.category === c}
            onClick={() => setFilter({ category: c, channel: '' })}
            count={counts[c]}
          >
            {t(CAT_LABELS[c])}
          </CategoryTab>
        ))}

        {showChannelFilter && (
          <div className="flex items-center gap-1 ml-3 pl-3 border-l border-slate-200">
            {[{ v: '', l: t('cat.all') }, { v: 'takeout', l: t('chan.takeout') }, { v: 'dinein', l: t('chan.dinein') }].map(({ v, l }) => (
              <button
                key={v}
                onClick={() => setFilter({ ...filter, channel: v as Channel | '' })}
                className={
                  'px-3 py-1 text-xs rounded-full ' +
                  (filter.channel === v ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100')
                }
              >
                {l}
              </button>
            ))}
          </div>
        )}

        <div className="ml-auto relative">
          <Search size={14} className="absolute left-2.5 top-2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('panel.search_with_code')}
            className="input pl-7 w-56"
          />
        </div>
      </div>

      {selected.size > 0 && (
        <div className="mb-3 rounded-xl border border-brand-200 bg-brand-50/70 px-4 py-2.5 flex flex-wrap items-center gap-2 shadow-soft">
          <span className="text-sm font-semibold text-brand-700">{t('meta.also_selected')} {selected.size}</span>
          <span className="text-slate-300">·</span>
          <select
            className="input !w-36 !py-1 !text-sm bg-white"
            value={bulkCat}
            onChange={(e) => setBulkCat(e.target.value as Category | '')}
          >
            <option value="">{t('mat.dropdown_unchanged_cat')}</option>
            <option value="raw">{t('mat.to_raw')}</option>
            <option value="packaging">{t('mat.to_packaging')}</option>
            <option value="sauce">{t('mat.to_sauce')}</option>
            <option value="other">{t('mat.to_other')}</option>
          </select>
          <select
            className="input !w-36 !py-1 !text-sm bg-white"
            value={bulkChan}
            onChange={(e) => setBulkChan(e.target.value as any)}
          >
            <option value="">{t('mat.dropdown_unchanged_chan')}</option>
            <option value="takeout">{t('mat.to_takeout')}</option>
            <option value="dinein">{t('mat.to_dinein')}</option>
            <option value="null">{t('mat.to_generic')}</option>
          </select>
          <button className="btn-primary !py-1" onClick={applyBulk}>
            <Check size={14} /> {t('mat.dropdown_apply')}
          </button>
          <button className="btn-danger !py-1" onClick={bulkDelete}>
            <Trash2 size={14} /> {t('btn.delete')}
          </button>
          <button className="btn-ghost !py-1 ml-auto" onClick={clearSelection}>
            <X size={14} /> {t('btn.cancel')}
          </button>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="px-4 py-2.5 w-10">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-300"
                  checked={items.length > 0 && selected.size === items.length}
                  ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < items.length; }}
                  onChange={toggleAllVisible}
                />
              </th>
              <th className="text-left px-4 py-2.5 font-medium">{t('lbl.code')}</th>
              <th className="text-left px-4 py-2.5 font-medium">{t('lbl.name')}</th>
              <th className="text-left px-4 py-2.5 font-medium">{t('lbl.category')}</th>
              <th className="text-left px-4 py-2.5 font-medium">{t('lbl.unit')}</th>
              {filter.category !== 'raw' && (
                <th className="text-left px-4 py-2.5 font-medium">{t('lbl.channel')}</th>
              )}
              <th className="text-left px-4 py-2.5 font-medium">{t('lbl.source')}</th>
              <th className="px-4 py-2.5 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const numCols = 7 + (filter.category !== 'raw' ? 1 : 0);
              return <>
                {loading && (
                  <tr><td colSpan={numCols} className="p-8 text-center text-slate-400">{t('mat.loading')}</td></tr>
                )}
                {!loading && items.length === 0 && (
                  <tr><td colSpan={numCols} className="p-8 text-center text-slate-400">{t('mat.empty')}</td></tr>
                )}
              </>;
            })()}
            {items.map((m) => (
              <tr
                key={m.item_code}
                className={
                  'border-t border-slate-100 hover:bg-slate-50/60 ' +
                  (selected.has(m.item_code) ? 'bg-brand-50/40' : '')
                }
              >
                <td className="px-4 py-2.5">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-300"
                    checked={selected.has(m.item_code)}
                    onChange={() => toggleOne(m.item_code)}
                  />
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{m.item_code}</td>
                <td className="px-4 py-2.5 font-medium text-slate-900">{materialName(m, lang)}</td>
                <td className="px-4 py-2.5">
                  <CategorySelect material={m} onChanged={load} />
                </td>
                <td className="px-4 py-2.5 text-slate-500">{m.uom || '—'}</td>
                {filter.category !== 'raw' && (
                  <td className="px-4 py-2.5"><ChannelChip channel={m.channel} /></td>
                )}
                <td className="px-4 py-2.5">
                  {m.source === 'erp'
                    ? <span className="chip bg-emerald-50 text-emerald-700">ERP</span>
                    : <span className="chip bg-slate-100 text-slate-500">{t('mat.source_manual')}</span>}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button className="btn-ghost !p-1" onClick={() => setEditing(m)} title={t('btn.edit')}>
                    <Pencil size={14} />
                  </button>
                  <button className="btn-danger !p-1" onClick={() => onDelete(m.item_code)} title={t('btn.delete')}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <MaterialEditor
          initial={editing === 'new' ? null : editing}
          defaultCategory={filter.category === 'all' ? 'raw' : filter.category}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
    </div>
  );
}

function MaterialEditor({ initial, defaultCategory, onClose, onSaved }: {
  initial: Material | null;
  defaultCategory: Category;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const isNew = !initial;
  const [code, setCode] = useState(initial?.item_code || '');
  const [name, setName] = useState(initial?.item_name || '');
  const [nameEn, setNameEn] = useState(initial?.name_en || '');
  const [nameTh, setNameTh] = useState(initial?.name_th || '');
  const [uom,  setUom ] = useState(initial?.uom || 'Nos');
  const [category, setCategory] = useState<Category>(initial?.category || defaultCategory);
  const [channel,  setChannel ] = useState<Channel | ''>((initial?.channel as Channel) || '');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        item_code: code.trim(),
        item_name: name.trim(),
        name_en: nameEn.trim() || null,
        name_th: nameTh.trim() || null,
        uom: uom.trim() || null,
        category,
        channel: (category === 'raw' || category === 'other') ? null : (channel || null),
      };
      if (isNew) await api.createMaterial(payload);
      else await api.updateMaterial(initial!.item_code, payload);
      onSaved();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/30 flex items-center justify-center p-6" onClick={onClose}>
      <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{isNew ? t('mat.btn_add') : t('btn.edit')}</h3>
          <button onClick={onClose} className="btn-ghost !p-1"><X size={16} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="label">{t('lbl.code')}</label>
            <input className="input mt-1 font-mono" value={code} disabled={!isNew}
                   onChange={(e) => setCode(e.target.value)} placeholder="RM-BUN-PLAIN" />
          </div>
          <div>
            <label className="label">{t('lbl.name_zh')}</label>
            <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('lbl.name_en')}</label>
              <input className="input mt-1" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </div>
            <div>
              <label className="label">{t('lbl.name_th')}</label>
              <input className="input mt-1" value={nameTh} onChange={(e) => setNameTh(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('lbl.category')}</label>
              <select className="input mt-1" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
                <option value="raw">{t('cat.raw')}</option>
                <option value="packaging">{t('cat.packaging')}</option>
                <option value="sauce">{t('cat.sauce')}</option>
                <option value="other">{t('cat.other')}</option>
              </select>
            </div>
            <div>
              <label className="label">{t('lbl.unit')}</label>
              <input className="input mt-1" value={uom} onChange={(e) => setUom(e.target.value)} />
            </div>
          </div>
          {category !== 'raw' && category !== 'other' && (
            <div>
              <label className="label">{t('lbl.channel')}</label>
              <div className="flex gap-2 mt-1">
                {[{v:'takeout',l:t('chan.takeout')},{v:'dinein',l:t('chan.dinein')}].map(({v,l}) => (
                  <button
                    key={v}
                    onClick={() => setChannel(v as Channel)}
                    className={
                      'flex-1 px-3 py-1.5 rounded-lg border text-sm ' +
                      (channel === v
                        ? 'bg-brand-500 text-white border-brand-500'
                        : 'border-slate-200 text-slate-600 hover:border-brand-300')
                    }
                  >{l}</button>
                ))}
              </div>
            </div>
          )}
          {err && <div className="text-rose-600 text-sm">{err}</div>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>{t('btn.cancel')}</button>
          <button className="btn-primary" onClick={save} disabled={saving || !code || !name}>
            <Check size={14} /> {t('btn.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
