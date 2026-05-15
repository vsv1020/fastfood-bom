import React, { useEffect, useState } from 'react';
import {
  DndContext, DragOverlay,
  type DragEndEvent, type DragStartEvent,
  useDraggable, useDroppable,
  PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  Plus, Save, Trash2, Search, GripVertical, X, Truck, Store,
  Package, Droplet, Sigma, ChevronDown, Shuffle,
} from 'lucide-react';
import { api } from '../api';
import type { Combo, ComboLine, ComboLineSubstitute, Product, Material, ComboBom, Channel } from '../types';

export default function CombosPage() {
  const [combos, setCombos] = useState<Combo[]>([]);
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null);
  const [pendingDrop, setPendingDrop] = useState<{ product: Product; ts: number } | null>(null);

  async function load() {
    setCombos(await api.listCombos());
  }
  useEffect(() => { load(); }, []);

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
              pendingDrop={pendingDrop}
              onConsumed={() => setPendingDrop(null)}
              onSaved={(c) => { setSelectedId(c.id); load(); }}
              onDeleted={() => { setSelectedId(null); load(); }}
            />
        }
      </section>

      <aside className="border-l border-slate-200 bg-white flex flex-col">
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
  return (
    <div
      className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white shadow-xl border border-brand-300 w-72 cursor-grabbing"
      style={{ pointerEvents: 'none' }}
    >
      <GripVertical size={14} className="text-brand-400" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-900 truncate">{product.name}</div>
        <div className="font-mono text-[10px] text-slate-500 truncate">{product.code}</div>
      </div>
      <span className="text-[10px] text-slate-400">{product.line_count} 项</span>
    </div>
  );
}

const COMBO_DROP_ID = 'combo-products-drop';

function ComboEditor({
  comboId, pendingDrop, onConsumed, onSaved, onDeleted,
}: {
  comboId: number | null;
  pendingDrop: { product: Product; ts: number } | null;
  onConsumed: () => void;
  onSaved: (c: Combo) => void;
  onDeleted: () => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<ComboLine[]>([]);
  const [pkgTo, setPkgTo] = useState<string[]>([]);
  const [pkgDi, setPkgDi] = useState<string[]>([]);
  const [sauceTo, setSauceTo] = useState<string[]>([]);
  const [sauceDi, setSauceDi] = useState<string[]>([]);
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
      setCode(''); setName(''); setDescription(''); setLines([]);
      setPkgTo([]); setPkgDi([]); setSauceTo([]); setSauceDi([]);
      setBom(null); setErr(null);
      return;
    }
    api.getCombo(comboId).then((c) => {
      setCode(c.code); setName(c.name); setDescription(c.description || '');
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
        description: description.trim() || null,
        lines: lines.map((l) => ({ product_id: l.product_id, qty: l.qty })),
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
    if (!confirm('删除该套餐?')) return;
    await api.deleteCombo(comboId);
    onDeleted();
  }

  return (
      <div className="h-full overflow-y-auto p-8 space-y-5">
        <header className="flex items-start justify-between">
          <div className="flex-1 max-w-xl space-y-3">
            <div>
              <label className="label flex items-center gap-2">
                套餐名称
                <span className="font-mono text-[10px] text-slate-400 normal-case tracking-normal">
                  {code || '(保存后自动分配编码)'}
                </span>
              </label>
              <input className="input mt-1" value={name}
                     onChange={(e) => setName(e.target.value)} placeholder="如 芝士牛肉堡套餐" />
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
            <button className="btn-primary" onClick={save} disabled={saving || !name}>
              <Save size={14} /> 保存
            </button>
          </div>
        </header>

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <ComboProductsDropZone lines={lines} onChange={setLines} allProducts={allProducts} />

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
  );
}

function ChannelGroup({
  icon, title, colorClass, packaging, sauce,
}: {
  icon: React.ReactNode;
  title: string;
  colorClass: string;
  packaging: { value: string[]; options: Material[]; onChange: (v: string[]) => void };
  sauce:     { value: string[]; options: Material[]; onChange: (v: string[]) => void };
}) {
  return (
    <div className={'card p-4 border ' + colorClass}>
      <div className="flex items-center gap-1.5 text-sm font-semibold mb-3">
        {icon} {title}
      </div>
      <div className="space-y-3">
        <MaterialMultiPicker
          icon={<Package size={13} className="text-slate-400" />}
          label="包材" value={packaging.value} options={packaging.options} onChange={packaging.onChange}
        />
        <MaterialMultiPicker
          icon={<Droplet size={13} className="text-slate-400" />}
          label="酱料" value={sauce.value} options={sauce.options} onChange={sauce.onChange}
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
  value: string[];
  options: Material[];
  onChange: (v: string[]) => void;
}) {
  const byCode = new Map(options.map((o) => [o.item_code, o]));
  const remaining = options.filter((o) => !value.includes(o.item_code));
  return (
    <div>
      <span className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-slate-500 mb-1">
        {icon} {label}{value.length > 0 && <span className="text-slate-400 normal-case">· 已选 {value.length}</span>}
      </span>
      <div className="rounded-lg border border-slate-200 bg-white p-1.5 flex flex-wrap gap-1.5 min-h-[36px]">
        {value.map((code) => {
          const m = byCode.get(code);
          const name = m ? m.item_name.split('|')[0].trim() : code;
          const tagClass = m?.channel === 'takeout' ? 'chip-pkg-to'
                          : m?.channel === 'dinein' ? 'chip-pkg-di'
                          : 'chip bg-slate-100 text-slate-600';
          return (
            <span key={code} className={tagClass + ' pr-1 pl-2 max-w-full'}>
              <span className="truncate">{name}</span>
              <button
                onClick={() => onChange(value.filter((c) => c !== code))}
                className="ml-1 -mr-0.5 rounded hover:bg-black/10 p-0.5"
                title="移除"
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
              if (v) onChange([...value, v]);
              e.target.value = '';
            }}
          >
            <option value="">+ 添加{label}…</option>
            {remaining.map((o) => {
              const tag = o.channel === 'takeout' ? '[外卖]' : o.channel === 'dinein' ? '[到店]' : '[通用]';
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
              <th className="text-left py-1.5 pl-2 w-20">优先级</th>
              <th className="text-left py-1.5">编码</th>
              <th className="text-left py-1.5">单品</th>
              <th className="text-right py-1.5 w-28">数量</th>
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
                    <span className="chip bg-brand-50 text-brand-700 border border-brand-100">主</span>
                  </td>
                  <td className="py-2 font-mono text-xs text-slate-600">{l.product_code}</td>
                  <td className="py-2 font-medium">{l.product_name}</td>
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
                      title="删除整行 (主+替换品)">
                      <X size={14} />
                    </button>
                  </td>
                </tr>
                {subs.map((s, j) => (
                  <tr key={`s-${j}-${s.product_id}`} className="bg-slate-50/60 border-t border-slate-100">
                    <td className="py-1.5 pl-2">
                      <span className="chip bg-amber-50 text-amber-700 border border-amber-100">替 P{s.priority}</span>
                    </td>
                    <td className="py-1.5 pl-4 font-mono text-xs text-slate-500">
                      <Shuffle size={11} className="inline mr-1 -mt-0.5 text-amber-500" />
                      {s.product_code}
                    </td>
                    <td className="py-1.5 text-slate-700">{s.product_name}</td>
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
                      <button className="btn-danger !p-1" onClick={() => removeSub(i, j)} title="移除该替换品">
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
                      <option value="">+ 添加替换单品…</option>
                      {subOpts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.code})
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
              <th className="text-left py-1.5 w-20">优先级</th>
              <th className="text-left py-1.5">类别</th>
              <th className="text-left py-1.5">编码</th>
              <th className="text-left py-1.5">名称</th>
              <th className="text-right py-1.5 w-24">数量</th>
              <th className="text-left py-1.5 w-16">单位</th>
            </tr>
          </thead>
          <tbody>
            {bom.bom.map((r) => (
              <tr key={`${r.item_code}|${r.priority}`}
                  className={'border-t border-slate-100 ' + (r.priority > 0 ? 'bg-amber-50/30' : '')}>
                <td className="py-1.5">
                  {r.priority === 0
                    ? <span className="chip bg-brand-50 text-brand-700 border border-brand-100">主</span>
                    : <span className="chip bg-amber-50 text-amber-700 border border-amber-100">替 P{r.priority}</span>}
                </td>
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

function ProductDragPanel({ onAddItem }: { onAddItem?: (p: Product) => void }) {
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
        <div className="text-[11px] text-slate-500 mt-0.5">拖到中间区域,或直接点击 +1</div>
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
      title={onAdd ? '点击或拖到中间区域加入套餐' : undefined}
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
