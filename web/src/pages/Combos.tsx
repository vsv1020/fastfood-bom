import { useEffect, useState } from 'react';
import {
  DndContext, type DragEndEvent, useDraggable, useDroppable,
  PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  Plus, Save, Trash2, Search, GripVertical, X, Truck, Store,
  Package, Droplet, Sigma, ChevronDown,
} from 'lucide-react';
import { api } from '../api';
import type { Combo, ComboLine, Product, Material, ComboBom, Channel } from '../types';

export default function CombosPage() {
  const [combos, setCombos] = useState<Combo[]>([]);
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null);

  async function load() {
    setCombos(await api.listCombos());
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="h-full grid grid-cols-[280px_1fr_320px]">
      <aside className="border-r border-slate-200 bg-white flex flex-col">
        <header className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">套餐</div>
            <div className="text-[11px] text-slate-500">{combos.length} 个套餐</div>
          </div>
          <button className="btn-primary !py-1 !px-2" onClick={() => setSelectedId('new')}>
            <Plus size={14} /> 新建
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">
          {combos.length === 0 && (
            <div className="p-6 text-center text-sm text-slate-400">
              还没有套餐<br /><span className="text-xs">点击"新建"开始</span>
            </div>
          )}
          {combos.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={
                'w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 ' +
                (selectedId === c.id ? 'bg-brand-50/60 border-l-2 border-l-brand-500' : '')
              }
            >
              <div className="text-sm font-medium text-slate-900">{c.name}</div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[11px] font-mono text-slate-500">{c.code}</span>
                <span className="text-[11px] text-slate-400">{c.line_count} 单品</span>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <section className="bg-slate-50 overflow-hidden">
        {selectedId == null
          ? <div className="h-full flex items-center justify-center text-slate-400 text-sm">
              选择左侧套餐,或点击「新建」开始组合
            </div>
          : <ComboEditor
              key={selectedId === 'new' ? 'new' : selectedId}
              comboId={selectedId === 'new' ? null : selectedId}
              onSaved={(c) => { setSelectedId(c.id); load(); }}
              onDeleted={() => { setSelectedId(null); load(); }}
            />
        }
      </section>

      <aside className="border-l border-slate-200 bg-white flex flex-col">
        <ProductDragPanel />
      </aside>
    </div>
  );
}

const COMBO_DROP_ID = 'combo-products-drop';

function ComboEditor({
  comboId, onSaved, onDeleted,
}: {
  comboId: number | null;
  onSaved: (c: Combo) => void;
  onDeleted: () => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<ComboLine[]>([]);
  const [pkgTo, setPkgTo] = useState<string | null>(null);
  const [pkgDi, setPkgDi] = useState<string | null>(null);
  const [sauceTo, setSauceTo] = useState<string | null>(null);
  const [sauceDi, setSauceDi] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // BOM preview
  const [previewChannel, setPreviewChannel] = useState<Channel>('takeout');
  const [bom, setBom] = useState<ComboBom | null>(null);

  // Material lookups
  const [pkgToOpts, setPkgToOpts] = useState<Material[]>([]);
  const [pkgDiOpts, setPkgDiOpts] = useState<Material[]>([]);
  const [sauceToOpts, setSauceToOpts] = useState<Material[]>([]);
  const [sauceDiOpts, setSauceDiOpts] = useState<Material[]>([]);

  useEffect(() => {
    api.listMaterials({ category: 'packaging', channel: 'takeout' }).then(setPkgToOpts);
    api.listMaterials({ category: 'packaging', channel: 'dinein'  }).then(setPkgDiOpts);
    api.listMaterials({ category: 'sauce',     channel: 'takeout' }).then(setSauceToOpts);
    api.listMaterials({ category: 'sauce',     channel: 'dinein'  }).then(setSauceDiOpts);
  }, []);

  useEffect(() => {
    if (comboId == null) {
      setCode(''); setName(''); setDescription(''); setLines([]);
      setPkgTo(null); setPkgDi(null); setSauceTo(null); setSauceDi(null);
      setBom(null); setErr(null);
      return;
    }
    api.getCombo(comboId).then((c) => {
      setCode(c.code); setName(c.name); setDescription(c.description || '');
      setLines(c.lines || []);
      setPkgTo(c.packaging_takeout_code); setPkgDi(c.packaging_dinein_code);
      setSauceTo(c.sauce_takeout_code); setSauceDi(c.sauce_dinein_code);
      setErr(null);
    });
  }, [comboId]);

  // Refresh BOM preview whenever combo state or channel changes
  useEffect(() => {
    if (comboId == null) { setBom(null); return; }
    api.comboBom(comboId, previewChannel).then(setBom).catch(() => setBom(null));
  }, [comboId, previewChannel, lines, pkgTo, pkgDi, sauceTo, sauceDi]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  function onDragEnd(e: DragEndEvent) {
    if (e.over?.id !== COMBO_DROP_ID) return;
    const p = e.active.data.current?.product as Product | undefined;
    if (!p) return;
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
  }

  async function save() {
    setSaving(true); setErr(null);
    try {
      const payload = {
        code: code.trim(), name: name.trim(),
        description: description.trim() || null,
        lines: lines.map((l) => ({ product_id: l.product_id, qty: l.qty })),
        packaging_takeout_code: pkgTo, packaging_dinein_code: pkgDi,
        sauce_takeout_code: sauceTo, sauce_dinein_code: sauceDi,
      };
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
    if (!confirm('删除该套餐?')) return;
    await api.deleteCombo(comboId);
    onDeleted();
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="h-full overflow-y-auto p-8 space-y-5">
        <header className="flex items-start justify-between">
          <div className="flex-1 max-w-xl space-y-3">
            <div className="grid grid-cols-[1fr_2fr] gap-3">
              <div>
                <label className="label">编码</label>
                <input className="input mt-1 font-mono" value={code}
                       onChange={(e) => setCode(e.target.value)} placeholder="如 C-CHEESE-COMBO" />
              </div>
              <div>
                <label className="label">套餐名称</label>
                <input className="input mt-1" value={name}
                       onChange={(e) => setName(e.target.value)} placeholder="如 芝士牛肉堡套餐" />
              </div>
            </div>
            <div>
              <label className="label">描述 (可选)</label>
              <input className="input mt-1" value={description}
                     onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2 mt-7">
            {comboId != null && (
              <button className="btn-danger" onClick={del}><Trash2 size={14} /> 删除</button>
            )}
            <button className="btn-primary" onClick={save} disabled={saving || !code || !name}>
              <Save size={14} /> 保存
            </button>
          </div>
        </header>

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <ComboProductsDropZone lines={lines} onChange={setLines} />

        <div className="grid grid-cols-2 gap-4">
          <ChannelGroup
            icon={<Truck size={14} />}
            title="外卖配置"
            colorClass="text-sky-700 bg-sky-50 border-sky-100"
            packaging={{ value: pkgTo, options: pkgToOpts, onChange: setPkgTo }}
            sauce    ={{ value: sauceTo, options: sauceToOpts, onChange: setSauceTo }}
          />
          <ChannelGroup
            icon={<Store size={14} />}
            title="到店配置"
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
    </DndContext>
  );
}

function ChannelGroup({
  icon, title, colorClass, packaging, sauce,
}: {
  icon: React.ReactNode;
  title: string;
  colorClass: string;
  packaging: { value: string | null; options: Material[]; onChange: (v: string | null) => void };
  sauce:     { value: string | null; options: Material[]; onChange: (v: string | null) => void };
}) {
  return (
    <div className={'card p-4 border ' + colorClass}>
      <div className="flex items-center gap-1.5 text-sm font-semibold mb-3">
        {icon} {title}
      </div>
      <div className="space-y-3">
        <MaterialPicker
          icon={<Package size={13} className="text-slate-400" />}
          label="包材" value={packaging.value} options={packaging.options} onChange={packaging.onChange}
        />
        <MaterialPicker
          icon={<Droplet size={13} className="text-slate-400" />}
          label="酱料" value={sauce.value} options={sauce.options} onChange={sauce.onChange}
        />
      </div>
    </div>
  );
}

function MaterialPicker({
  icon, label, value, options, onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  options: Material[];
  onChange: (v: string | null) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-slate-500 mb-1">
        {icon} {label}
      </span>
      <div className="relative">
        <select
          className="input appearance-none pr-8 bg-white"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">— 不配置 —</option>
          {options.map((o) => (
            <option key={o.item_code} value={o.item_code}>{o.item_name} ({o.item_code})</option>
          ))}
        </select>
        <ChevronDown size={14} className="absolute right-2.5 top-2.5 text-slate-400 pointer-events-none" />
      </div>
    </label>
  );
}

function ComboProductsDropZone({
  lines, onChange,
}: {
  lines: ComboLine[];
  onChange: (l: ComboLine[]) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: COMBO_DROP_ID });
  return (
    <div
      ref={setNodeRef}
      className={
        'card p-5 transition border-2 ' +
        (isOver ? 'border-brand-400 bg-brand-50/30' : 'border-transparent')
      }
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-slate-900">套餐内单品</h3>
        <span className="text-xs text-slate-400">{lines.length} 个单品</span>
      </div>
      {lines.length === 0 ? (
        <div className="h-32 flex items-center justify-center border-2 border-dashed border-slate-200 rounded-xl text-sm text-slate-400">
          📦 把右侧"单品"拖到这里组成套餐 (相同单品自动 +1)
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-400 uppercase">
            <tr>
              <th className="text-left py-1.5">编码</th>
              <th className="text-left py-1.5">单品</th>
              <th className="text-right py-1.5 w-32">数量</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.product_id} className="border-t border-slate-100">
                <td className="py-2 font-mono text-xs text-slate-600">{l.product_code}</td>
                <td className="py-2 font-medium">{l.product_name}</td>
                <td className="py-2">
                  <input
                    type="number" step="1" min="0"
                    className="input text-right ml-auto w-28"
                    value={l.qty}
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      const next = [...lines];
                      next[i] = { ...l, qty: isNaN(v) ? 0 : v };
                      onChange(next);
                    }}
                  />
                </td>
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

function BomPreview({
  channel, onChannelChange, bom, unsaved,
}: {
  channel: Channel;
  onChannelChange: (c: Channel) => void;
  bom: ComboBom | null;
  unsaved: boolean;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-slate-900 flex items-center gap-1.5">
          <Sigma size={16} className="text-brand-500" /> 汇总 BOM 预览
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
              {c === 'takeout' ? '外卖' : '到店'}
            </button>
          ))}
        </div>
      </div>

      {unsaved && (
        <div className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg p-3 mb-3">
          ⚠️ 保存后才能看到汇总 BOM (按渠道 / 包材 / 酱料 自动计算)
        </div>
      )}

      {!unsaved && (!bom || bom.bom.length === 0) && (
        <div className="text-sm text-slate-400 py-6 text-center">
          没有 BOM 行 — 给套餐加点单品吧
        </div>
      )}

      {bom && bom.bom.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-400 uppercase">
            <tr>
              <th className="text-left py-1.5">类别</th>
              <th className="text-left py-1.5">编码</th>
              <th className="text-left py-1.5">名称</th>
              <th className="text-right py-1.5 w-24">数量</th>
              <th className="text-left py-1.5 w-16">单位</th>
            </tr>
          </thead>
          <tbody>
            {bom.bom.map((r) => (
              <tr key={r.item_code} className="border-t border-slate-100">
                <td className="py-1.5">
                  {r.category === 'packaging' && <span className="chip-pkg-to">包材</span>}
                  {r.category === 'sauce'     && <span className="chip-sauce">酱料</span>}
                  {r.category === 'raw'       && <span className="chip-raw">原料</span>}
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

function ProductDragPanel() {
  const [items, setItems] = useState<Product[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => { api.listProducts().then(setItems); }, []);
  const filtered = items.filter((p) =>
    !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.code.toLowerCase().includes(q.toLowerCase())
  );
  return (
    <>
      <header className="p-4 border-b border-slate-100">
        <div className="text-sm font-semibold text-slate-900">单品库</div>
        <div className="text-[11px] text-slate-500 mt-0.5">拖到中间区域加入套餐</div>
        <div className="relative mt-3">
          <Search size={14} className="absolute left-2.5 top-2 text-slate-400" />
          <input className="input pl-7" placeholder="搜索单品…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-2">
        {filtered.length === 0 && (
          <div className="text-center text-sm text-slate-400 py-8">
            没有单品<br /><span className="text-xs">请先在「单品 BOM」配置</span>
          </div>
        )}
        {filtered.map((p) => <DraggableProduct key={p.id} product={p} />)}
      </div>
    </>
  );
}

function DraggableProduct({ product }: { product: Product }) {
  const id = `prod-${product.id}`;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id, data: { product },
  });
  const style: React.CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 }
    : {};
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={
        'group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-grab active:cursor-grabbing ' +
        'hover:bg-brand-50 hover:shadow-sm border border-transparent hover:border-brand-200 transition ' +
        (isDragging ? 'bg-white shadow-lg border-brand-300' : '')
      }
    >
      <GripVertical size={14} className="text-slate-300 group-hover:text-brand-400" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-800 truncate">{product.name}</div>
        <div className="font-mono text-[10px] text-slate-400 truncate">{product.code}</div>
      </div>
      <span className="text-[10px] text-slate-400">{product.line_count} 项</span>
    </div>
  );
}
