import { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Search, Trash2, Pencil, X, Check, Merge, Sparkles, Split, Download } from 'lucide-react';
import { api } from '../api';
import type { Material, Category, Channel } from '../types';

// Tab keys 不包含 'other' — 未分类的物料仅出现在「全部」tab,不占独立 tab
type CategoryTabKey = 'all' | 'raw' | 'packaging' | 'sauce';
type Filter = { category: CategoryTabKey; channel: Channel | '' };

const CAT_LABELS: Record<CategoryTabKey, string> = {
  all: '全部',
  raw: '原材料',
  packaging: '包材',
  sauce: '酱料',
};

function CategoryChip({ cat }: { cat: Category }) {
  if (cat === 'raw') return <span className="chip-raw">原料</span>;
  if (cat === 'packaging') return <span className="chip-pkg-to">包材</span>;
  if (cat === 'sauce') return <span className="chip-sauce">酱料</span>;
  return <span className="chip bg-slate-100 text-slate-500">未分类</span>;
}

// 行内类别切换 — 点 chip-like select 直接改类别
function CategorySelect({ material, onChanged }: { material: Material; onChanged: () => void }) {
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
      title="点击切换类别 — 选「未分类」可从分类 tab 移除"
      onChange={async (e) => {
        const newCat = e.target.value as Category;
        if (newCat === material.category) return;
        try {
          // raw 或 other 不应有渠道,清空 channel
          const clearChannel = newCat === 'raw' || newCat === 'other';
          await api.updateMaterial(material.item_code, {
            category: newCat,
            channel: clearChannel ? null : (material.channel ?? null),
          });
          onChanged();
        } catch (err: any) { alert('更新失败: ' + err.message); }
      }}
    >
      <option value="raw">原料</option>
      <option value="packaging">包材</option>
      <option value="sauce">酱料</option>
      <option value="other">未分类</option>
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
  if (channel === 'takeout') return <span className="chip-pkg-to">外卖</span>;
  if (channel === 'dinein')  return <span className="chip-pkg-di">到店</span>;
  return <span className="chip bg-slate-100 text-slate-500">通用</span>;
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
      const parts = [`写入 ${r.count} 条原材料`, `名称字段=${r.name_field}`];
      if (!r.name_field_used && r.name_field_requested !== 'item_name') {
        parts.push(`(ERP 未返回 ${r.name_field_requested},已退回 item_name)`);
      }
      if (r.name_missing > 0) parts.push(`${r.name_missing} 条缺中文名`);
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
    <div className="p-8 max-w-7xl mx-auto">
      <header className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">物料库</h1>
          <p className="text-sm text-slate-500 mt-1">
            BOM 的最小单元 — 原材料、包材(分外卖/到店)、酱料(分外卖/到店)。
          </p>
        </div>
        <div className="flex gap-2">
          <a className="btn-outline" href="/api/export/materials.csv" download title="导出当前物料库为 CSV">
            <Download size={14} /> 导出
          </a>
          <button className="btn-outline" onClick={onClassify} title="按关键词把 ERP 原材料自动分到 包材 / 酱料">
            <Sparkles size={14} /> 自动分类
          </button>
          <button className="btn-outline" onClick={onSplitChannel} title="按名字关键词把通用包材/酱料分流到 外卖 / 到店">
            <Split size={14} /> 分流渠道
          </button>
          <button className="btn-outline" onClick={onDedupe} title="按 名称+类别 合并重复项,优先保留 ERP 来源">
            <Merge size={14} /> 去重
          </button>
          <button className="btn-outline" onClick={onSync}>
            <RefreshCw size={14} /> 从 ERP 同步原材料
          </button>
          <button className="btn-primary" onClick={() => setEditing('new')}>
            <Plus size={14} /> 新增物料
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
            {CAT_LABELS[c]}
          </CategoryTab>
        ))}

        {showChannelFilter && (
          <div className="flex items-center gap-1 ml-3 pl-3 border-l border-slate-200">
            {[{ v: '', l: '全部' }, { v: 'takeout', l: '外卖' }, { v: 'dinein', l: '到店' }].map(({ v, l }) => (
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
            placeholder="搜索 编码 / 名称"
            className="input pl-7 w-56"
          />
        </div>
      </div>

      {selected.size > 0 && (
        <div className="mb-3 rounded-xl border border-brand-200 bg-brand-50/70 px-4 py-2.5 flex flex-wrap items-center gap-2 shadow-soft">
          <span className="text-sm font-semibold text-brand-700">已选 {selected.size} 条</span>
          <span className="text-slate-300">·</span>
          <select
            className="input !w-36 !py-1 !text-sm bg-white"
            value={bulkCat}
            onChange={(e) => setBulkCat(e.target.value as Category | '')}
          >
            <option value="">→ 类别 (不变)</option>
            <option value="raw">→ 原材料</option>
            <option value="packaging">→ 包材</option>
            <option value="sauce">→ 酱料</option>
            <option value="other">→ 未分类</option>
          </select>
          <select
            className="input !w-36 !py-1 !text-sm bg-white"
            value={bulkChan}
            onChange={(e) => setBulkChan(e.target.value as any)}
          >
            <option value="">→ 渠道 (不变)</option>
            <option value="takeout">→ 外卖</option>
            <option value="dinein">→ 到店</option>
            <option value="null">→ 通用 (清空)</option>
          </select>
          <button className="btn-primary !py-1" onClick={applyBulk}>
            <Check size={14} /> 应用
          </button>
          <button className="btn-danger !py-1" onClick={bulkDelete}>
            <Trash2 size={14} /> 批量删除
          </button>
          <button className="btn-ghost !py-1 ml-auto" onClick={clearSelection}>
            <X size={14} /> 取消选择
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
              <th className="text-left px-4 py-2.5 font-medium">编码</th>
              <th className="text-left px-4 py-2.5 font-medium">名称</th>
              <th className="text-left px-4 py-2.5 font-medium">类别</th>
              <th className="text-left px-4 py-2.5 font-medium">单位</th>
              {filter.category !== 'raw' && (
                <th className="text-left px-4 py-2.5 font-medium">渠道</th>
              )}
              <th className="text-left px-4 py-2.5 font-medium">来源</th>
              <th className="px-4 py-2.5 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const numCols = 7 + (filter.category !== 'raw' ? 1 : 0);
              return <>
                {loading && (
                  <tr><td colSpan={numCols} className="p-8 text-center text-slate-400">加载中…</td></tr>
                )}
                {!loading && items.length === 0 && (
                  <tr><td colSpan={numCols} className="p-8 text-center text-slate-400">暂无数据</td></tr>
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
                <td className="px-4 py-2.5 font-medium text-slate-900">{m.item_name}</td>
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
                    : <span className="chip bg-slate-100 text-slate-500">手动</span>}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button className="btn-ghost !p-1" onClick={() => setEditing(m)} title="编辑">
                    <Pencil size={14} />
                  </button>
                  <button className="btn-danger !p-1" onClick={() => onDelete(m.item_code)} title="删除">
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
  );
}

function MaterialEditor({ initial, defaultCategory, onClose, onSaved }: {
  initial: Material | null;
  defaultCategory: Category;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !initial;
  const [code, setCode] = useState(initial?.item_code || '');
  const [name, setName] = useState(initial?.item_name || '');
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
          <h3 className="text-lg font-semibold">{isNew ? '新增物料' : '编辑物料'}</h3>
          <button onClick={onClose} className="btn-ghost !p-1"><X size={16} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="label">编码</label>
            <input className="input mt-1 font-mono" value={code} disabled={!isNew}
                   onChange={(e) => setCode(e.target.value)} placeholder="如 RM-BUN-PLAIN" />
          </div>
          <div>
            <label className="label">名称</label>
            <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">类别</label>
              <select className="input mt-1" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
                <option value="raw">原材料</option>
                <option value="packaging">包材</option>
                <option value="sauce">酱料</option>
                <option value="other">未分类</option>
              </select>
            </div>
            <div>
              <label className="label">单位</label>
              <input className="input mt-1" value={uom} onChange={(e) => setUom(e.target.value)} />
            </div>
          </div>
          {category !== 'raw' && category !== 'other' && (
            <div>
              <label className="label">渠道</label>
              <div className="flex gap-2 mt-1">
                {[{v:'takeout',l:'外卖'},{v:'dinein',l:'到店'}].map(({v,l}) => (
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
              <p className="text-[11px] text-slate-400 mt-1">外卖 / 到店 包材酱料用于套餐配置时二选一</p>
            </div>
          )}
          {err && <div className="text-rose-600 text-sm">{err}</div>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>取消</button>
          <button className="btn-primary" onClick={save} disabled={saving || !code || !name}>
            <Check size={14} /> 保存
          </button>
        </div>
      </div>
    </div>
  );
}
