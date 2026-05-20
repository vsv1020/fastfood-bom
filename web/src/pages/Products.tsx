import React, { useEffect, useMemo, useState } from 'react';
import {
  DndContext, DragOverlay,
  type DragEndEvent, type DragStartEvent,
  useDraggable, useDroppable,
  PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { Save, Trash2, Search, GripVertical, X, Shuffle, Copy } from 'lucide-react';
import { api } from '../api';
import type { Material, Product, ProductLine, ProductLineSubstitute, Folder } from '../types';
import { useLang, useT, localizedName } from '../i18n';
import { FolderTree, flattenFolders, type TreeItemData } from '../FolderTree';

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null);
  const [newItemFolderId, setNewItemFolderId] = useState<number | null>(null);
  const [pendingDrop, setPendingDrop] = useState<{ material: Material; ts: number } | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const { lang } = useLang();
  const t = useT();

  async function load() {
    const [ps, fs] = await Promise.all([api.listProducts(), api.listFolders('product')]);
    setProducts(ps);
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
      try { await api.deleteProduct(id); } catch { failed.push(id); }
    }
    if (selectedId !== 'new' && selectedId != null && checked.has(selectedId)) setSelectedId(null);
    clearChecks();
    load();
    if (failed.length) alert(`${failed.length} 条删除失败 (被引用): ${failed.join(', ')}`);
  }

  const [activeMat, setActiveMat] = useState<Material | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  function onDragStart(e: DragStartEvent) {
    setActiveMat((e.active.data.current?.material as Material | undefined) ?? null);
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveMat(null);
    if (e.over?.id !== PRODUCT_DROP_ID) return;
    const m = e.active.data.current?.material as Material | undefined;
    if (!m) return;
    setPendingDrop({ material: m, ts: Date.now() });
  }
  function onDragCancel() { setActiveMat(null); }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
    <div className="h-full flex">
      {/* 左:单品文件夹树 */}
      <aside className="w-72 shrink-0 border-r border-slate-200 bg-white flex flex-col min-h-0">
        <FolderTree
          kind="product"
          title={t('title.bom_units')}
          exportHref="/api/export/products.csv"
          folders={folders}
          items={products.map((p): TreeItemData => ({
            id: p.id,
            folder_id: p.folder_id ?? null,
            name: localizedName(p, lang),
            code: p.code,
            meta: `${p.line_count ?? 0} ${t('meta.n_rows')}`,
          }))}
          selectedItemId={typeof selectedId === 'number' ? selectedId : null}
          checked={checked}
          onSelectItem={(id) => setSelectedId(id)}
          onToggleCheck={toggleCheck}
          onCheckAll={() => setChecked(new Set(products.map((p) => p.id)))}
          onClearChecks={clearChecks}
          onBulkDelete={bulkDelete}
          onNewItem={(folderId) => { setNewItemFolderId(folderId); setSelectedId('new'); }}
          onReload={load}
        />
      </aside>

      {/* 中:编辑器 */}
      <section className="flex-1 min-w-0 bg-slate-50 overflow-hidden">
        {selectedId == null ? (
          <EmptyState text={t('empty.select_or_new_product')} />
        ) : (
          <ProductEditor
            key={selectedId === 'new' ? `new-${newItemFolderId ?? ''}` : selectedId}
            productId={selectedId === 'new' ? null : selectedId}
            presetFolderId={newItemFolderId}
            folders={folders}
            pendingDrop={pendingDrop}
            onConsumed={() => setPendingDrop(null)}
            onSaved={(p) => { setSelectedId(p.id); load(); }}
            onDeleted={() => { setSelectedId(null); load(); }}
          />
        )}
      </section>

      {/* 右:原材料库面板 */}
      <aside className="w-80 shrink-0 border-l border-slate-200 bg-white flex flex-col min-h-0">
        <MaterialDragPanel
          category="raw"
          title={t('panel.material_lib')}
          hint={t('panel.material_hint')}
          onAddItem={(m) => setPendingDrop({ material: m, ts: Date.now() })}
        />
      </aside>
    </div>
    <DragOverlay dropAnimation={null}>
      {activeMat ? <MaterialDragPreview material={activeMat} /> : null}
    </DragOverlay>
    </DndContext>
  );
}

function MaterialDragPreview({ material }: { material: Material }) {
  return (
    <div
      className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white shadow-xl border border-brand-300 w-72 cursor-grabbing"
      style={{ pointerEvents: 'none' }}
    >
      <GripVertical size={14} className="text-brand-400" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-900 truncate">{material.item_name}</div>
        <div className="font-mono text-[10px] text-slate-500 truncate">{material.item_code}</div>
      </div>
      <span className="text-[10px] text-slate-400">{material.uom}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="h-full flex items-center justify-center text-slate-400 text-sm p-8">
      {text}
    </div>
  );
}

/* ---------------- Product editor with drag target ---------------- */

const PRODUCT_DROP_ID = 'product-bom-drop';

function ProductEditor({
  productId, presetFolderId, folders, pendingDrop, onConsumed, onSaved, onDeleted,
}: {
  productId: number | null;
  presetFolderId: number | null;
  folders: Folder[];
  pendingDrop: { material: Material; ts: number } | null;
  onConsumed: () => void;
  onSaved: (p: Product) => void;
  onDeleted: () => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameTh, setNameTh] = useState('');
  const [description, setDescription] = useState('');
  const [folderId, setFolderId] = useState<number | null>(presetFolderId);
  const [lines, setLines] = useState<ProductLine[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [allRaw, setAllRaw] = useState<Material[]>([]);
  const t = useT();

  useEffect(() => { api.listMaterials({ category: 'raw' }).then(setAllRaw); }, []);

  useEffect(() => {
    if (productId == null) {
      setCode(''); setName(''); setNameEn(''); setNameTh(''); setDescription('');
      setFolderId(presetFolderId); setLines([]); setErr(null);
      return;
    }
    api.getProduct(productId).then((p) => {
      setCode(p.code); setName(p.name);
      setNameEn(p.name_en || ''); setNameTh(p.name_th || '');
      setDescription(p.description || '');
      setFolderId(p.folder_id ?? null);
      setLines(p.lines || []); setErr(null);
    });
  }, [productId]);

  // Apply a drop signal coming from the page-level DndContext
  useEffect(() => {
    if (!pendingDrop) return;
    const m = pendingDrop.material;
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.material_code === m.item_code);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, {
        material_code: m.item_code, qty: 1,
        item_name: m.item_name, uom: m.uom, category: m.category,
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
        lines: lines.map((l) => ({ material_code: l.material_code, qty: l.qty, substitutes: l.substitutes })),
      };
      if (code.trim()) payload.code = code.trim();
      const p = productId == null
        ? await api.createProduct(payload)
        : await api.updateProduct(productId, payload);
      onSaved(p);
    } catch (e: any) {
      setErr(e.message);
    } finally { setSaving(false); }
  }

  async function del() {
    if (productId == null) return;
    if (!confirm(t('editor.confirm_delete_product'))) return;
    await api.deleteProduct(productId);
    onDeleted();
  }

  async function duplicate() {
    setSaving(true); setErr(null);
    try {
      // 用当前编辑器状态创建一个新单品;不带 code,后端自动分配新编码
      const p = await api.createProduct({
        name: (name.trim() || '—') + ' ' + t('editor.copy_suffix'),
        name_en: nameEn.trim() || null,
        name_th: nameTh.trim() || null,
        description: description.trim() || null,
        folder_id: folderId,
        lines: lines.map((l) => ({ material_code: l.material_code, qty: l.qty, substitutes: l.substitutes })),
      } as any);
      onSaved(p);
    } catch (e: any) {
      setErr(e.message);
    } finally { setSaving(false); }
  }

  return (
      <div className="h-full flex flex-col p-8 overflow-y-auto">
        <header className="flex items-start justify-between mb-6">
          <div className="flex-1 max-w-2xl space-y-3">
            <div>
              <label className="label flex items-center gap-2">
                {t('editor.zh_main')}
                <span className="font-mono text-[10px] text-slate-400 normal-case tracking-normal">
                  {code || t('lbl.placeholder_auto_code')}
                </span>
              </label>
              <input className="input mt-1" value={name}
                     onChange={(e) => setName(e.target.value)} placeholder="如 芝士牛肉堡" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">English Name</label>
                <input className="input mt-1" value={nameEn}
                       onChange={(e) => setNameEn(e.target.value)} placeholder="e.g. Cheese Beef Burger" />
              </div>
              <div>
                <label className="label">ชื่อภาษาไทย</label>
                <input className="input mt-1" value={nameTh}
                       onChange={(e) => setNameTh(e.target.value)} placeholder="เช่น ชีสบีฟเบอร์เกอร์" />
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
            {productId != null && (
              <button className="btn-danger" onClick={del}><Trash2 size={14} /> {t('btn.delete')}</button>
            )}
            {productId != null && (
              <button className="btn-outline" onClick={duplicate} disabled={saving} title={t('btn.duplicate')}>
                <Copy size={14} /> {t('btn.duplicate')}
              </button>
            )}
            <button className="btn-primary" onClick={save} disabled={saving || !name}>
              <Save size={14} /> {t('btn.save')}
            </button>
          </div>
        </header>

        {err && <div className="mb-4 text-sm text-rose-600">{err}</div>}

        <ProductBomDropZone
          lines={lines}
          onChange={setLines}
          allMaterials={allRaw}
        />

        <p className="text-xs text-slate-400 mt-4">{t('editor.qty_hint')}</p>
      </div>
  );
}

function ProductBomDropZone({
  lines, onChange, allMaterials,
}: {
  lines: ProductLine[];
  onChange: (l: ProductLine[]) => void;
  allMaterials: Material[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: PRODUCT_DROP_ID });
  const t = useT();

  function updateLine(i: number, patch: Partial<ProductLine>) {
    const next = [...lines];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function addSubstitute(i: number, code: string) {
    const m = allMaterials.find((x) => x.item_code === code);
    if (!m) return;
    const subs = lines[i].substitutes || [];
    if (subs.some((s) => s.material_code === code)) return;
    if (lines[i].material_code === code) return; // 不能替换自己
    const nextPri = (subs.reduce((mx, s) => Math.max(mx, s.priority), 0) || 0) + 1;
    updateLine(i, { substitutes: [...subs, {
      material_code: code, qty: 1, priority: nextPri,
      item_name: m.item_name, uom: m.uom, category: m.category,
    }] });
  }
  function updateSub(i: number, j: number, patch: Partial<ProductLineSubstitute>) {
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
        'card flex-1 min-h-[280px] p-5 transition border-2 ' +
        (isOver ? 'border-brand-400 bg-brand-50/30' : 'border-transparent')
      }
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-slate-900">{t('editor.bom_list')}</h3>
        <span className="text-xs text-slate-400">{lines.length} {t('meta.n_rows')}</span>
      </div>
      {lines.length === 0 ? (
        <div className="h-48 flex items-center justify-center border-2 border-dashed border-slate-200 rounded-xl text-sm text-slate-400">
          {t('editor.empty_bom')}
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-400 uppercase">
            <tr>
              <th className="text-left py-1.5 pl-2 w-20">{t('lbl.priority')}</th>
              <th className="text-left py-1.5">{t('lbl.code')}</th>
              <th className="text-left py-1.5">{t('lbl.name')}</th>
              <th className="text-right py-1.5 w-28">{t('lbl.qty')}</th>
              <th className="text-left py-1.5 w-14">{t('lbl.unit')}</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const subs = l.substitutes || [];
              const usedCodes = new Set([l.material_code, ...subs.map((s) => s.material_code)]);
              const subOpts = allMaterials.filter((m) => !usedCodes.has(m.item_code));
              return (
              <React.Fragment key={l.id ?? `new-${i}-${l.material_code}`}>
                <tr className="border-t-2 border-slate-200">
                  <td className="py-2 pl-2">
                    <span className="chip bg-brand-50 text-brand-700 border border-brand-100">{t('lbl.main')}</span>
                  </td>
                  <td className="py-2 font-mono text-xs text-slate-600">{l.material_code}</td>
                  <td className="py-2 font-medium">{l.item_name}</td>
                  <td className="py-2">
                    <input
                      type="number" step="0.01" min="0"
                      className="input text-right ml-auto w-24"
                      value={l.qty}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        updateLine(i, { qty: isNaN(v) ? 0 : v });
                      }}
                    />
                  </td>
                  <td className="py-2 text-slate-500">{l.uom || '—'}</td>
                  <td className="py-2 text-right">
                    <button className="btn-danger !p-1"
                      onClick={() => onChange(lines.filter((_, idx) => idx !== i))}
                      title={t('editor.delete_row_title')}>
                      <X size={14} />
                    </button>
                  </td>
                </tr>
                {subs.map((s, j) => (
                  <tr key={`s-${j}-${s.material_code}`} className="bg-slate-50/60 border-t border-slate-100">
                    <td className="py-1.5 pl-2">
                      <span className="chip bg-amber-50 text-amber-700 border border-amber-100">{t('lbl.sub')} P{s.priority}</span>
                    </td>
                    <td className="py-1.5 pl-4 font-mono text-xs text-slate-500">
                      <Shuffle size={11} className="inline mr-1 -mt-0.5 text-amber-500" />
                      {s.material_code}
                    </td>
                    <td className="py-1.5 text-slate-700">{s.item_name}</td>
                    <td className="py-1.5">
                      <input
                        type="number" step="0.01" min="0"
                        className="input text-right ml-auto w-24"
                        value={s.qty}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          updateSub(i, j, { qty: isNaN(v) ? 0 : v });
                        }}
                      />
                    </td>
                    <td className="py-1.5 text-slate-500">{s.uom || '—'}</td>
                    <td className="py-1.5 text-right">
                      <button className="btn-danger !p-1" onClick={() => removeSub(i, j)} title={t('editor.remove_sub')}>
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-dashed border-slate-200">
                  <td colSpan={6} className="py-1.5 pl-6">
                    <select
                      className="text-xs text-slate-500 bg-transparent cursor-pointer hover:text-brand-600 border-0 focus:outline-none focus:ring-1 focus:ring-brand-200 rounded px-1"
                      value=""
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v) addSubstitute(i, v);
                        e.target.value = '';
                      }}
                    >
                      <option value="">{t('editor.add_sub')}</option>
                      {subOpts.map((m) => (
                        <option key={m.item_code} value={m.item_code}>
                          {m.item_name.split('|')[0].trim()} ({m.item_code})
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

/* ---------------- Reusable material drag panel ---------------- */

export function MaterialDragPanel({
  category, title, hint, channel, onAddItem,
}: {
  category: 'raw' | 'packaging' | 'sauce';
  title: string;
  hint: string;
  channel?: 'takeout' | 'dinein';
  onAddItem?: (m: Material) => void;
}) {
  const [items, setItems] = useState<Material[]>([]);
  const [q, setQ] = useState('');
  const t = useT();

  async function load() {
    setItems(await api.listMaterials({ category, channel, q: q || undefined }));
  }
  useEffect(() => { load(); }, [category, channel, q]);

  return (
    <>
      <header className="p-4 border-b border-slate-100">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <div className="text-[11px] text-slate-500 mt-0.5">{hint}</div>
        <div className="relative mt-3">
          <Search size={14} className="absolute left-2.5 top-2 text-slate-400" />
          <input className="input pl-7" placeholder={t('panel.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-2">
        {items.length === 0 && (
          <div className="text-center text-sm text-slate-400 py-8">—</div>
        )}
        {items.map((m) => (
          <DraggableMaterial
            key={m.item_code} material={m}
            onAdd={onAddItem ? () => onAddItem(m) : undefined}
          />
        ))}
      </div>
    </>
  );
}

function DraggableMaterial({ material, onAdd }: { material: Material; onAdd?: () => void }) {
  const id = `mat-${material.item_code}`;
  const t = useT();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id, data: { material },
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
      title={onAdd ? t('panel.material_hint') : undefined}
    >
      <GripVertical size={14} className="text-slate-300 group-hover:text-brand-400" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-800 truncate">{material.item_name}</div>
        <div className="font-mono text-[10px] text-slate-400 truncate">{material.item_code}</div>
      </div>
      <span className="text-[10px] text-slate-400">{material.uom}</span>
    </div>
  );
}
