import React, { useEffect, useState } from 'react';
import {
  DndContext, DragOverlay,
  type DragEndEvent, type DragStartEvent,
  useDraggable, useDroppable,
  PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  Save, Trash2, Search, GripVertical, X, Truck, Store,
  Package, Droplet, Sigma, ChevronDown, Shuffle, Copy,
} from 'lucide-react';
import { api } from '../api';
import type { Combo, ComboLine, ComboLineSubstitute, Product, Material, ComboBom, Channel, PackEntry, Folder } from '../types';
import { useLang, useT, localizedName } from '../i18n';
import { FolderTree, flattenFolders, type TreeItemData } from '../FolderTree';

export default function CombosPage() {
  const [combos, setCombos] = useState<Combo[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null);
  const [newItemFolderId, setNewItemFolderId] = useState<number | null>(null);
  const [pendingDrop, setPendingDrop] = useState<{ product: Product; ts: number } | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const { lang } = useLang();
  const t = useT();

  async function load() {
    const [cs, fs] = await Promise.all([api.listCombos(), api.listFolders('combo')]);
    setCombos(cs);
    setFolders(fs);
  }
  useEffect(() => { load(); }, []);

  function toggleCheck(id: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function clearChecks() { setChecked(new Set()); }
  async function bulkDelete() {
    if (checked.size === 0) return;
    if (!confirm(`${t('btn.delete')} ${checked.size} ?`)) return;
    const ids = [...checked];
    const failed: number[] = [];
    for (const id of ids) {
      try { await api.deleteCombo(id); } catch { failed.push(id); }
    }
    if (selectedId !== 'new' && selectedId != null && checked.has(selectedId)) setSelectedId(null);
    clearChecks();
    load();
    if (failed.length) alert(`${failed.length} 条删除失败: ${failed.join(', ')}`);
  }

  const [activeProd, setActiveProd] = useState<Product | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  function onDragStart(e: DragStartEvent) {
    setActiveProd((e.active.data.current?.product as Product | undefined) ?? null);
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveProd(null);
    if (e.over?.id !== COMBO_DROP_ID) return;
    const p = e.active.data.current?.product as Product | undefined;
    if (!p) return;
    setPendingDrop({ product: p, ts: Date.now() });
  }
  function onDragCancel() { setActiveProd(null); }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
    <div className="h-full flex">
      <aside className="w-72 shrink-0 border-r border-slate-200 bg-white flex flex-col min-h-0">
        <FolderTree
          kind="combo"
          title={t('title.bom_sets')}
          exportHref="/api/export/combos.csv"
          folders={folders}
          items={combos.map((c): TreeItemData => ({
            id: c.id,
            folder_id: c.folder_id ?? null,
            name: localizedName(c, lang),
            code: c.code,
            meta: `${c.line_count ?? 0} ${t('meta.n_products')}`,
          }))}
          selectedItemId={typeof selectedId === 'number' ? selectedId : null}
          checked={checked}
          onSelectItem={(id) => setSelectedId(id)}
          onToggleCheck={toggleCheck}
          onCheckAll={() => setChecked(new Set(combos.map((c) => c.id)))}
          onClearChecks={clearChecks}
          onBulkDelete={bulkDelete}
          onNewItem={(folderId) => { setNewItemFolderId(folderId); setSelectedId('new'); }}
          onReload={load}
        />
      </aside>

      <section className="flex-1 min-w-0 bg-slate-50 overflow-hidden">
        {selectedId == null
          ? <div className="h-full flex items-center justify-center text-slate-400 text-sm">
              {t('empty.select_or_new_combo')}
            </div>
          : <ComboEditor
              key={selectedId === 'new' ? `new-${newItemFolderId ?? ''}` : selectedId}
              comboId={selectedId === 'new' ? null : selectedId}
              presetFolderId={newItemFolderId}
              folders={folders}
              pendingDrop={pendingDrop}
              onConsumed={() => setPendingDrop(null)}
              onSaved={(c) => { setSelectedId(c.id); load(); }}
              onDeleted={() => { setSelectedId(null); load(); }}
            />
        }
      </section>

      <aside className="w-80 shrink-0 border-l border-slate-200 bg-white flex flex-col min-h-0">
        <ProductDragPanel
          onAddItem={(p) => setPendingDrop({ product: p, ts: Date.now() })}
        />
      </aside>
    </div>
    <DragOverlay dropAnimation={null}>
      {activeProd ? <ProductDragPreview product={activeProd} /> : null}
    </DragOverlay>
    </DndContext>
  );
}

function ProductDragPreview({ product }: { product: Product }) {
  const { lang } = useLang();
  const t = useT();
  return (
    <div
      className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white shadow-xl border border-brand-300 w-72 cursor-grabbing"
      style={{ pointerEvents: 'none' }}
    >
      <GripVertical size={14} className="text-brand-400" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-900 truncate">{localizedName(product, lang)}</div>
        <div className="font-mono text-[10px] text-slate-500 truncate">{product.code}</div>
      </div>
      <span className="text-[10px] text-slate-400">{product.line_count} {t('meta.n_rows')}</span>
    </div>
  );
}

const COMBO_DROP_ID = 'combo-products-drop';

function ComboEditor({
  comboId, presetFolderId, folders, pendingDrop, onConsumed, onSaved, onDeleted,
}: {
  comboId: number | null;
  presetFolderId: number | null;
  folders: Folder[];
  pendingDrop: { product: Product; ts: number } | null;
  onConsumed: () => void;
  onSaved: (c: Combo) => void;
  onDeleted: () => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameTh, setNameTh] = useState('');
  const [description, setDescription] = useState('');
  const [folderId, setFolderId] = useState<number | null>(presetFolderId);
  const [lines, setLines] = useState<ComboLine[]>([]);
  const [pkgTo, setPkgTo] = useState<PackEntry[]>([]);
  const [pkgDi, setPkgDi] = useState<PackEntry[]>([]);
  const [sauceTo, setSauceTo] = useState<PackEntry[]>([]);
  const [sauceDi, setSauceDi] = useState<PackEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // BOM preview
  const [previewChannel, setPreviewChannel] = useState<Channel>('takeout');
  const [bom, setBom] = useState<ComboBom | null>(null);

  // 物料源:拉全部包材/酱料,前端按 (channel == target || channel == null) 过滤
  const [pkgAll,   setPkgAll]   = useState<Material[]>([]);
  const [sauceAll, setSauceAll] = useState<Material[]>([]);
  // 单品候选,用作套餐内单品的替换品来源
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const t = useT();

  useEffect(() => {
    api.listMaterials({ category: 'packaging' }).then(setPkgAll);
    api.listMaterials({ category: 'sauce'     }).then(setSauceAll);
    api.listProducts().then(setAllProducts);
  }, []);

  // 渠道在前、通用在后;同组按名字
  function sortByChannelFirst(target: Channel) {
    return (a: Material, b: Material) => {
      const aw = a.channel === target ? 0 : 1;
      const bw = b.channel === target ? 0 : 1;
      if (aw !== bw) return aw - bw;
      return a.item_name.localeCompare(b.item_name);
    };
  }
  const pkgToOpts   = pkgAll.filter(x => x.channel === 'takeout' || x.channel == null).sort(sortByChannelFirst('takeout'));
  const pkgDiOpts   = pkgAll.filter(x => x.channel === 'dinein'  || x.channel == null).sort(sortByChannelFirst('dinein'));
  const sauceToOpts = sauceAll.filter(x => x.channel === 'takeout' || x.channel == null).sort(sortByChannelFirst('takeout'));
  const sauceDiOpts = sauceAll.filter(x => x.channel === 'dinein'  || x.channel == null).sort(sortByChannelFirst('dinein'));

  useEffect(() => {
    if (comboId == null) {
      setCode(''); setName(''); setNameEn(''); setNameTh(''); setDescription(''); setLines([]);
      setFolderId(presetFolderId);
      setPkgTo([]); setPkgDi([]); setSauceTo([]); setSauceDi([]);
      setBom(null); setErr(null);
      return;
    }
    api.getCombo(comboId).then((c) => {
      setCode(c.code); setName(c.name);
      setNameEn(c.name_en || ''); setNameTh(c.name_th || '');
      setDescription(c.description || '');
      setFolderId(c.folder_id ?? null);
      setLines(c.lines || []);
      setPkgTo(c.packaging_takeout_codes || []); setPkgDi(c.packaging_dinein_codes || []);
      setSauceTo(c.sauce_takeout_codes || []); setSauceDi(c.sauce_dinein_codes || []);
      setErr(null);
    });
  }, [comboId]);

  // Refresh BOM preview whenever combo state or channel changes
  useEffect(() => {
    if (comboId == null) { setBom(null); return; }
    api.comboBom(comboId, previewChannel).then(setBom).catch(() => setBom(null));
  }, [comboId, previewChannel, lines, pkgTo, pkgDi, sauceTo, sauceDi]);

  // Apply drop signal from the page-level DndContext
  useEffect(() => {
    if (!pendingDrop) return;
    const p = pendingDrop.product;
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.product_id === p.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, {
        product_id: p.id, qty: 1,
        product_code: p.code, product_name: p.name,
      }];
    });
    onConsumed();
  }, [pendingDrop]);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const payload: any = {
        name: name.trim(),
        name_en: nameEn.trim() || null,
        name_th: nameTh.trim() || null,
        description: description.trim() || null,
        folder_id: folderId,
        lines: lines.map((l) => ({ product_id: l.product_id, qty: l.qty, substitutes: l.substitutes })),
        packaging_takeout_codes: pkgTo, packaging_dinein_codes: pkgDi,
        sauce_takeout_codes: sauceTo, sauce_dinein_codes: sauceDi,
      };
      if (code.trim()) payload.code = code.trim();
      const c = comboId == null
        ? await api.createCombo(payload)
        : await api.updateCombo(comboId, payload);
      onSaved(c);
    } catch (e: any) {
      setErr(e.message);
    } finally { setSaving(false); }
  }

  async function del() {
    if (comboId == null) return;
    if (!confirm(t('editor.confirm_delete_combo'))) return;
    await api.deleteCombo(comboId);
    onDeleted();
  }

  async function duplicate() {
    setSaving(true); setErr(null);
    try {
      // 用当前编辑器状态创建一个新套餐;不带 code,后端自动分配新编码
      const c = await api.createCombo({
        name: (name.trim() || '—') + ' ' + t('editor.copy_suffix'),
        name_en: nameEn.trim() || null,
        name_th: nameTh.trim() || null,
        description: description.trim() || null,
        folder_id: folderId,
        lines: lines.map((l) => ({ product_id: l.product_id, qty: l.qty, substitutes: l.substitutes })),
        packaging_takeout_codes: pkgTo, packaging_dinein_codes: pkgDi,
        sauce_takeout_codes: sauceTo, sauce_dinein_codes: sauceDi,
      } as any);
      onSaved(c);
    } catch (e: any) {
      setErr(e.message);
    } finally { setSaving(false); }
  }

  return (
      <div className="h-full overflow-y-auto p-8 space-y-5">
        <header className="flex items-start justify-between">
          <div className="flex-1 max-w-2xl space-y-3">
            <div>
              <label className="label flex items-center gap-2">
                {t('editor.zh_main')}
                <span className="font-mono text-[10px] text-slate-400 normal-case tracking-normal">
                  {code || t('lbl.placeholder_auto_code')}
                </span>
              </label>
              <input className="input mt-1" value={name}
                     onChange={(e) => setName(e.target.value)} placeholder="如 芝士牛肉堡套餐" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">English Name</label>
                <input className="input mt-1" value={nameEn}
                       onChange={(e) => setNameEn(e.target.value)} placeholder="e.g. Cheese Beef Burger Set" />
              </div>
              <div>
                <label className="label">ชื่อภาษาไทย</label>
                <input className="input mt-1" value={nameTh}
                       onChange={(e) => setNameTh(e.target.value)} placeholder="เช่น ชุดชีสบีฟเบอร์เกอร์" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{t('lbl.desc')} ({t('placeholder.optional')})</label>
                <input className="input mt-1" value={description}
                       onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div>
                <label className="label">{t('editor.folder')}</label>
                <select className="input mt-1" value={folderId ?? ''}
                        onChange={(e) => setFolderId(e.target.value === '' ? null : Number(e.target.value))}>
                  <option value="">{t('folder.ungrouped')}</option>
                  {flattenFolders(folders).map((f) => (
                    <option key={f.id} value={f.id}>{f.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-7">
            {comboId != null && (
              <button className="btn-danger" onClick={del}><Trash2 size={14} /> {t('btn.delete')}</button>
            )}
            {comboId != null && (
              <button className="btn-outline" onClick={duplicate} disabled={saving} title={t('btn.duplicate')}>
                <Copy size={14} /> {t('btn.duplicate')}
              </button>
            )}
            <button className="btn-primary" onClick={save} disabled={saving || !name}>
              <Save size={14} /> {t('btn.save')}
            </button>
          </div>
        </header>

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <ComboProductsDropZone lines={lines} onChange={setLines} allProducts={allProducts} />

        <div className="grid grid-cols-2 gap-4">
          <ChannelGroup
            icon={<Truck size={14} />}
            title={t('editor.takeout_config')}
            colorClass="text-sky-700 bg-sky-50 border-sky-100"
            packaging={{ value: pkgTo, options: pkgToOpts, onChange: setPkgTo }}
            sauce    ={{ value: sauceTo, options: sauceToOpts, onChange: setSauceTo }}
          />
          <ChannelGroup
            icon={<Store size={14} />}
            title={t('editor.dinein_config')}
            colorClass="text-violet-700 bg-violet-50 border-violet-100"
            packaging={{ value: pkgDi, options: pkgDiOpts, onChange: setPkgDi }}
            sauce    ={{ value: sauceDi, options: sauceDiOpts, onChange: setSauceDi }}
          />
        </div>

        <BomPreview
          channel={previewChannel}
          onChannelChange={setPreviewChannel}
          bom={bom}
          unsaved={comboId == null}
        />
      </div>
  );
}

function ChannelGroup({
  icon, title, colorClass, packaging, sauce,
}: {
  icon: React.ReactNode;
  title: string;
  colorClass: string;
  packaging: { value: PackEntry[]; options: Material[]; onChange: (v: PackEntry[]) => void };
  sauce:     { value: PackEntry[]; options: Material[]; onChange: (v: PackEntry[]) => void };
}) {
  const t = useT();
  return (
    <div className={'card p-4 border ' + colorClass}>
      <div className="flex items-center gap-1.5 text-sm font-semibold mb-3">
        {icon} {title}
      </div>
      <div className="space-y-3">
        <MaterialMultiPicker
          icon={<Package size={13} className="text-slate-400" />}
          label={t('editor.packaging')} value={packaging.value} options={packaging.options} onChange={packaging.onChange}
        />
        <MaterialMultiPicker
          icon={<Droplet size={13} className="text-slate-400" />}
          label={t('editor.sauce')} value={sauce.value} options={sauce.options} onChange={sauce.onChange}
        />
      </div>
    </div>
  );
}

function MaterialMultiPicker({
  icon, label, value, options, onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: PackEntry[];
  options: Material[];
  onChange: (v: PackEntry[]) => void;
}) {
  const t = useT();
  const byCode = new Map(options.map((o) => [o.item_code, o]));
  const remaining = options.filter((o) => !value.some((e) => e.code === o.item_code));
  return (
    <div>
      <span className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-slate-500 mb-1">
        {icon} {label}{value.length > 0 && <span className="text-slate-400 normal-case">· {t('meta.also_selected')} {value.length}</span>}
      </span>
      <div className="rounded-lg border border-slate-200 bg-white p-1.5 flex flex-wrap gap-1.5 min-h-[36px]">
        {value.map((entry, idx) => {
          const m = byCode.get(entry.code);
          const name = m ? m.item_name.split('|')[0].trim() : entry.code;
          const tagClass = m?.channel === 'takeout' ? 'chip-pkg-to'
                          : m?.channel === 'dinein' ? 'chip-pkg-di'
                          : 'chip bg-slate-100 text-slate-600';
          return (
            <span key={entry.code} className={tagClass + ' pr-1 pl-2 max-w-full inline-flex items-center gap-1'}>
              <span className="truncate">{name}</span>
              <span className="text-slate-300 mx-0.5">×</span>
              <input
                type="number"
                min="0"
                step="0.5"
                className="w-12 text-xs bg-white/70 border border-white/0 rounded px-1 py-0 text-right tabular-nums focus:outline-none focus:border-brand-300 focus:ring-1 focus:ring-brand-200"
                value={entry.qty}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  const next = [...value];
                  next[idx] = { ...entry, qty: isNaN(v) ? 0 : v };
                  onChange(next);
                }}
              />
              <button
                onClick={() => onChange(value.filter((_, i) => i !== idx))}
                className="ml-0.5 rounded hover:bg-black/10 p-0.5"
                title={t('btn.delete')}
              >
                <X size={11} />
              </button>
            </span>
          );
        })}
        <div className="relative flex-1 min-w-[150px]">
          <select
            className="w-full appearance-none bg-transparent text-xs text-slate-500 focus:outline-none px-1 py-0.5 cursor-pointer hover:text-brand-600"
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v) onChange([...value, { code: v, qty: 1 }]);
              e.target.value = '';
            }}
          >
            <option value="">+ {label}…</option>
            {remaining.map((o) => {
              const tag = o.channel === 'takeout' ? `[${t('chan.takeout')}]` : o.channel === 'dinein' ? `[${t('chan.dinein')}]` : `[${t('chan.generic')}]`;
              return (
                <option key={o.item_code} value={o.item_code}>
                  {tag} {o.item_name.split('|')[0].trim()} ({o.item_code})
                </option>
              );
            })}
          </select>
        </div>
      </div>
    </div>
  );
}

function ComboProductsDropZone({
  lines, onChange, allProducts,
}: {
  lines: ComboLine[];
  onChange: (l: ComboLine[]) => void;
  allProducts: Product[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: COMBO_DROP_ID });
  const t = useT();
  const { lang } = useLang();

  function updateLine(i: number, patch: Partial<ComboLine>) {
    const next = [...lines]; next[i] = { ...next[i], ...patch }; onChange(next);
  }
  function addSubstitute(i: number, productId: number) {
    const p = allProducts.find((x) => x.id === productId);
    if (!p) return;
    const subs = lines[i].substitutes || [];
    if (subs.some((s) => s.product_id === productId)) return;
    if (lines[i].product_id === productId) return;
    const nextPri = (subs.reduce((mx, s) => Math.max(mx, s.priority), 0) || 0) + 1;
    updateLine(i, { substitutes: [...subs, {
      product_id: productId, qty: 1, priority: nextPri,
      product_code: p.code, product_name: p.name,
    }] });
  }
  function updateSub(i: number, j: number, patch: Partial<ComboLineSubstitute>) {
    const subs = [...(lines[i].substitutes || [])];
    subs[j] = { ...subs[j], ...patch };
    updateLine(i, { substitutes: subs });
  }
  function removeSub(i: number, j: number) {
    const subs = (lines[i].substitutes || []).filter((_, idx) => idx !== j);
    updateLine(i, { substitutes: subs });
  }

  return (
    <div
      ref={setNodeRef}
      className={
        'card p-5 transition border-2 ' +
        (isOver ? 'border-brand-400 bg-brand-50/30' : 'border-transparent')
      }
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-slate-900">{t('editor.combo_items')}</h3>
        <span className="text-xs text-slate-400">{lines.length} {t('meta.n_products')}</span>
      </div>
      {lines.length === 0 ? (
        <div className="h-32 flex items-center justify-center border-2 border-dashed border-slate-200 rounded-xl text-sm text-slate-400">
          {t('editor.empty_combo')}
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-400 uppercase">
            <tr>
              <th className="text-left py-1.5 pl-2 w-20">{t('lbl.priority')}</th>
              <th className="text-left py-1.5">{t('lbl.code')}</th>
              <th className="text-left py-1.5">{t('lbl.name')}</th>
              <th className="text-right py-1.5 w-28">{t('lbl.qty')}</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const subs = l.substitutes || [];
              const usedIds = new Set([l.product_id, ...subs.map((s) => s.product_id)]);
              const subOpts = allProducts.filter((p) => !usedIds.has(p.id));
              return (
              <React.Fragment key={l.id ?? `cln-${i}-${l.product_id}`}>
                <tr className="border-t-2 border-slate-200">
                  <td className="py-2 pl-2">
                    <span className="chip bg-brand-50 text-brand-700 border border-brand-100">{t('lbl.main')}</span>
                  </td>
                  <td className="py-2 font-mono text-xs text-slate-600">{l.product_code}</td>
                  <td className="py-2 font-medium">{localizedName({ name: l.product_name || '', name_en: allProducts.find(p=>p.id===l.product_id)?.name_en, name_th: allProducts.find(p=>p.id===l.product_id)?.name_th }, lang)}</td>
                  <td className="py-2">
                    <input
                      type="number" step="1" min="0"
                      className="input text-right ml-auto w-24"
                      value={l.qty}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        updateLine(i, { qty: isNaN(v) ? 0 : v });
                      }}
                    />
                  </td>
                  <td className="py-2 text-right">
                    <button className="btn-danger !p-1"
                      onClick={() => onChange(lines.filter((_, idx) => idx !== i))}
                      title={t('editor.delete_row_title')}>
                      <X size={14} />
                    </button>
                  </td>
                </tr>
                {subs.map((s, j) => (
                  <tr key={`s-${j}-${s.product_id}`} className="bg-slate-50/60 border-t border-slate-100">
                    <td className="py-1.5 pl-2">
                      <span className="chip bg-amber-50 text-amber-700 border border-amber-100">{t('lbl.sub')} P{s.priority}</span>
                    </td>
                    <td className="py-1.5 pl-4 font-mono text-xs text-slate-500">
                      <Shuffle size={11} className="inline mr-1 -mt-0.5 text-amber-500" />
                      {s.product_code}
                    </td>
                    <td className="py-1.5 text-slate-700">{localizedName({ name: s.product_name || '', name_en: allProducts.find(p=>p.id===s.product_id)?.name_en, name_th: allProducts.find(p=>p.id===s.product_id)?.name_th }, lang)}</td>
                    <td className="py-1.5">
                      <input
                        type="number" step="1" min="0"
                        className="input text-right ml-auto w-24"
                        value={s.qty}
                        onChange={(e) => {
                          const v = parseInt(e.target.value);
                          updateSub(i, j, { qty: isNaN(v) ? 0 : v });
                        }}
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      <button className="btn-danger !p-1" onClick={() => removeSub(i, j)} title={t('editor.remove_sub')}>
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-dashed border-slate-200">
                  <td colSpan={5} className="py-1.5 pl-6">
                    <select
                      className="text-xs text-slate-500 bg-transparent cursor-pointer hover:text-brand-600 border-0 focus:outline-none focus:ring-1 focus:ring-brand-200 rounded px-1"
                      value=""
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v) addSubstitute(i, Number(v));
                        e.target.value = '';
                      }}
                    >
                      <option value="">{t('editor.add_sub_product')}</option>
                      {subOpts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {localizedName(p, lang)} ({p.code})
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function BomPreview({
  channel, onChannelChange, bom, unsaved,
}: {
  channel: Channel;
  onChannelChange: (c: Channel) => void;
  bom: ComboBom | null;
  unsaved: boolean;
}) {
  const t = useT();
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-slate-900 flex items-center gap-1.5">
          <Sigma size={16} className="text-brand-500" /> {t('editor.bom_preview')}
        </h3>
        <div className="flex bg-slate-100 rounded-lg p-0.5">
          {(['takeout', 'dinein'] as Channel[]).map((c) => (
            <button
              key={c}
              onClick={() => onChannelChange(c)}
              className={
                'flex items-center gap-1 px-3 py-1 text-xs rounded-md transition ' +
                (channel === c ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-500')
              }
            >
              {c === 'takeout' ? <Truck size={12} /> : <Store size={12} />}
              {c === 'takeout' ? t('chan.takeout') : t('chan.dinein')}
            </button>
          ))}
        </div>
      </div>

      {unsaved && (
        <div className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg p-3 mb-3">
          {t('editor.unsaved_bom')}
        </div>
      )}

      {!unsaved && (!bom || bom.bom.length === 0) && (
        <div className="text-sm text-slate-400 py-6 text-center">
          {t('editor.no_bom_rows')}
        </div>
      )}

      {bom && bom.bom.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-400 uppercase">
            <tr>
              <th className="text-left py-1.5 w-20">{t('lbl.priority')}</th>
              <th className="text-left py-1.5">{t('lbl.category')}</th>
              <th className="text-left py-1.5">{t('lbl.code')}</th>
              <th className="text-left py-1.5">{t('lbl.name')}</th>
              <th className="text-right py-1.5 w-24">{t('lbl.qty')}</th>
              <th className="text-left py-1.5 w-16">{t('lbl.unit')}</th>
            </tr>
          </thead>
          <tbody>
            {bom.bom.map((r) => (
              <tr key={`${r.item_code}|${r.priority}`}
                  className={'border-t border-slate-100 ' + (r.priority > 0 ? 'bg-amber-50/30' : '')}>
                <td className="py-1.5">
                  {r.priority === 0
                    ? <span className="chip bg-brand-50 text-brand-700 border border-brand-100">{t('lbl.main')}</span>
                    : <span className="chip bg-amber-50 text-amber-700 border border-amber-100">{t('lbl.sub')} P{r.priority}</span>}
                </td>
                <td className="py-1.5">
                  {r.category === 'packaging' && <span className="chip-pkg-to">{t('cat.packaging')}</span>}
                  {r.category === 'sauce'     && <span className="chip-sauce">{t('cat.sauce')}</span>}
                  {r.category === 'raw'       && <span className="chip-raw">{t('cat.raw')}</span>}
                </td>
                <td className="py-1.5 font-mono text-xs text-slate-600">{r.item_code}</td>
                <td className="py-1.5 font-medium">{r.item_name}</td>
                <td className="py-1.5 text-right tabular-nums">{round(r.qty)}</td>
                <td className="py-1.5 text-slate-500">{r.uom || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

/* ---------------- Product drag panel ---------------- */

function ProductDragPanel({ onAddItem }: { onAddItem?: (p: Product) => void }) {
  const [items, setItems] = useState<Product[]>([]);
  const [q, setQ] = useState('');
  const { lang } = useLang();
  const t = useT();
  useEffect(() => { api.listProducts().then(setItems); }, []);
  const filtered = items.filter((p) => {
    if (!q) return true;
    const Q = q.toLowerCase();
    return (
      p.name.toLowerCase().includes(Q) ||
      (p.name_en || '').toLowerCase().includes(Q) ||
      (p.name_th || '').toLowerCase().includes(Q) ||
      p.code.toLowerCase().includes(Q)
    );
  });
  return (
    <>
      <header className="p-4 border-b border-slate-100">
        <div className="text-sm font-semibold text-slate-900">{t('panel.product_lib')}</div>
        <div className="text-[11px] text-slate-500 mt-0.5">{t('panel.product_hint')}</div>
        <div className="relative mt-3">
          <Search size={14} className="absolute left-2.5 top-2 text-slate-400" />
          <input className="input pl-7" placeholder={t('panel.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-2">
        {filtered.length === 0 && (
          <div className="text-center text-sm text-slate-400 py-8">
            {t('empty.no_products')}
          </div>
        )}
        {filtered.map((p) => (
          <DraggableProduct
            key={p.id} product={p}
            onAdd={onAddItem ? () => onAddItem(p) : undefined}
          />
        ))}
      </div>
    </>
  );
}

function DraggableProduct({ product, onAdd }: { product: Product; onAdd?: () => void }) {
  const id = `prod-${product.id}`;
  const { lang } = useLang();
  const t = useT();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id, data: { product },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ opacity: isDragging ? 0.4 : 1 }}
      {...listeners}
      {...attributes}
      onClick={onAdd}
      className={
        'group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer active:cursor-grabbing ' +
        'hover:bg-brand-50 hover:shadow-sm border border-transparent hover:border-brand-200 transition'
      }
      title={onAdd ? t('panel.product_hint') : undefined}
    >
      <GripVertical size={14} className="text-slate-300 group-hover:text-brand-400" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-800 truncate">{localizedName(product, lang)}</div>
        <div className="font-mono text-[10px] text-slate-400 truncate">{product.code}</div>
      </div>
      <span className="text-[10px] text-slate-400">{product.line_count} {t('meta.n_rows')}</span>
    </div>
  );
}
