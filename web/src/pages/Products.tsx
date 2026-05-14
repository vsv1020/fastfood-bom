import { useEffect, useMemo, useState } from 'react';
import {
  DndContext, DragOverlay,
  type DragEndEvent, type DragStartEvent,
  useDraggable, useDroppable,
  PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { Plus, Save, Trash2, Search, GripVertical, X } from 'lucide-react';
import { api } from '../api';
import type { Material, Product, ProductLine } from '../types';

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<{ material: Material; ts: number } | null>(null);

  async function load() {
    setLoading(true);
    setProducts(await api.listProducts());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

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
    <div className="h-full grid grid-cols-[280px_1fr_320px]">
      {/* 左:单品列表 */}
      <aside className="border-r border-slate-200 bg-white flex flex-col">
        <header className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">单品 BOM</div>
            <div className="text-[11px] text-slate-500">{products.length} 个单品</div>
          </div>
          <button className="btn-primary !py-1 !px-2" onClick={() => setSelectedId('new')}>
            <Plus size={14} /> 新建
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="p-4 text-sm text-slate-400">加载中…</div>}
          {!loading && products.length === 0 && (
            <div className="p-6 text-center text-sm text-slate-400">
              还没有单品<br />
              <span className="text-xs">从右上角"新建"开始</span>
            </div>
          )}
          {products.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={
                'w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 ' +
                (selectedId === p.id ? 'bg-brand-50/60 border-l-2 border-l-brand-500' : '')
              }
            >
              <div className="text-sm font-medium text-slate-900">{p.name}</div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[11px] font-mono text-slate-500">{p.code}</span>
                <span className="text-[11px] text-slate-400">{p.line_count} 行</span>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* 中:编辑器 */}
      <section className="bg-slate-50">
        {selectedId == null ? (
          <EmptyState text="从左侧选择一个单品,或点击「新建」开始配置" />
        ) : (
          <ProductEditor
            key={selectedId === 'new' ? 'new' : selectedId}
            productId={selectedId === 'new' ? null : selectedId}
            pendingDrop={pendingDrop}
            onConsumed={() => setPendingDrop(null)}
            onSaved={(p) => { setSelectedId(p.id); load(); }}
            onDeleted={() => { setSelectedId(null); load(); }}
          />
        )}
      </section>

      {/* 右:原材料库面板 */}
      <aside className="border-l border-slate-200 bg-white flex flex-col">
        <MaterialDragPanel
          category="raw"
          title="原材料库"
          hint="拖到中间区域,或直接点击 +1"
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
  productId, pendingDrop, onConsumed, onSaved, onDeleted,
}: {
  productId: number | null;
  pendingDrop: { material: Material; ts: number } | null;
  onConsumed: () => void;
  onSaved: (p: Product) => void;
  onDeleted: () => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<ProductLine[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (productId == null) {
      setCode(''); setName(''); setDescription(''); setLines([]); setErr(null);
      return;
    }
    api.getProduct(productId).then((p) => {
      setCode(p.code); setName(p.name); setDescription(p.description || '');
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
        description: description.trim() || null,
        lines: lines.map((l) => ({ material_code: l.material_code, qty: l.qty })),
      };
      if (code.trim()) payload.code = code.trim(); // 编辑时保留原 code
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
    if (!confirm('删除该单品? 已使用此单品的套餐将失效')) return;
    await api.deleteProduct(productId);
    onDeleted();
  }

  return (
      <div className="h-full flex flex-col p-8 overflow-y-auto">
        <header className="flex items-start justify-between mb-6">
          <div className="flex-1 max-w-xl space-y-3">
            <div>
              <label className="label flex items-center gap-2">
                单品名称
                <span className="font-mono text-[10px] text-slate-400 normal-case tracking-normal">
                  {code || '(保存后自动分配编码)'}
                </span>
              </label>
              <input className="input mt-1" value={name}
                     onChange={(e) => setName(e.target.value)} placeholder="如 芝士牛肉堡" />
            </div>
            <div>
              <label className="label">描述 (可选)</label>
              <input className="input mt-1" value={description}
                     onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2 mt-7">
            {productId != null && (
              <button className="btn-danger" onClick={del}><Trash2 size={14} /> 删除</button>
            )}
            <button className="btn-primary" onClick={save} disabled={saving || !name}>
              <Save size={14} /> 保存
            </button>
          </div>
        </header>

        {err && <div className="mb-4 text-sm text-rose-600">{err}</div>}

        <ProductBomDropZone
          lines={lines}
          onChange={setLines}
        />

        <p className="text-xs text-slate-400 mt-4">
          💡 提示: 从右侧"原材料库"面板拖动物料到上面区域,系统会自动按编码合并并 +1。
          数量、删除可在每行直接编辑。
        </p>
      </div>
  );
}

function ProductBomDropZone({
  lines, onChange,
}: {
  lines: ProductLine[];
  onChange: (l: ProductLine[]) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: PRODUCT_DROP_ID });
  return (
    <div
      ref={setNodeRef}
      className={
        'card flex-1 min-h-[280px] p-5 transition border-2 ' +
        (isOver ? 'border-brand-400 bg-brand-50/30' : 'border-transparent')
      }
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-slate-900">BOM 物料清单</h3>
        <span className="text-xs text-slate-400">{lines.length} 行</span>
      </div>
      {lines.length === 0 ? (
        <div className="h-48 flex items-center justify-center border-2 border-dashed border-slate-200 rounded-xl text-sm text-slate-400">
          🍔 把右侧原材料拖到这里,或点击右侧物料即可添加
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-400 uppercase">
            <tr>
              <th className="text-left py-1.5">编码</th>
              <th className="text-left py-1.5">名称</th>
              <th className="text-right py-1.5 w-32">数量</th>
              <th className="text-left py-1.5 w-16">单位</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.material_code} className="border-t border-slate-100">
                <td className="py-2 font-mono text-xs text-slate-600">{l.material_code}</td>
                <td className="py-2 font-medium">{l.item_name}</td>
                <td className="py-2">
                  <input
                    type="number" step="0.01" min="0"
                    className="input text-right ml-auto w-28"
                    value={l.qty}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      const next = [...lines];
                      next[i] = { ...l, qty: isNaN(v) ? 0 : v };
                      onChange(next);
                    }}
                  />
                </td>
                <td className="py-2 text-slate-500">{l.uom || '—'}</td>
                <td className="py-2 text-right">
                  <button className="btn-danger !p-1"
                    onClick={() => onChange(lines.filter((_, idx) => idx !== i))}>
                    <X size={14} />
                  </button>
                </td>
              </tr>
            ))}
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
          <input className="input pl-7" placeholder="搜索…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-2">
        {items.length === 0 && (
          <div className="text-center text-sm text-slate-400 py-8">空</div>
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
      title={onAdd ? '点击或拖到中间区域加入 BOM' : undefined}
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
