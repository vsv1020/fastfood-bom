import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, ShoppingCart, Sigma, Truck, Store, Package, Share2, Layers } from 'lucide-react';
import { api } from '../api';
import type { Product, Combo, BomRow, Channel } from '../types';

type SharedHit = {
  group_id: number;
  code: string;
  name: string;
  channel: Channel | null;
  lines: { material_code: string; qty: number; substitutes: { material_code: string; qty: number; priority: number }[] }[];
};

type OrderItem =
  | { kind: 'product'; id: number; qty: number }
  | { kind: 'combo';   id: number; qty: number; channel: Channel };

export default function OrdersPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [combos,   setCombos]   = useState<Combo[]>([]);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [bom, setBom] = useState<BomRow[]>([]);
  const [resolved, setResolved] = useState<Awaited<ReturnType<typeof api.orderPreview>>['items']>([]);
  const [sharedHits, setSharedHits] = useState<SharedHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.listProducts().then(setProducts);
    api.listCombos().then(setCombos);
  }, []);

  // 实时汇总:items 每次变化都重新算
  useEffect(() => {
    if (items.length === 0) { setBom([]); setResolved([]); setSharedHits([]); return; }
    setLoading(true);
    api.orderPreview(items).then((r) => {
      setBom(r.bom);
      setResolved(r.items);
      setSharedHits((r as any).shared_hits || []);
    }).catch(() => { setBom([]); setResolved([]); setSharedHits([]); })
      .finally(() => setLoading(false));
  }, [items]);

  function addProduct(id: number) {
    if (!id) return;
    setItems((prev) => {
      const idx = prev.findIndex((x) => x.kind === 'product' && x.id === id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { kind: 'product', id, qty: 1 }];
    });
  }
  function addCombo(id: number, channel: Channel = 'takeout') {
    if (!id) return;
    setItems((prev) => {
      const idx = prev.findIndex((x) => x.kind === 'combo' && x.id === id && x.channel === channel);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { kind: 'combo', id, qty: 1, channel }];
    });
  }
  function updateItem(i: number, patch: Partial<OrderItem>) {
    const next = [...items];
    next[i] = { ...next[i], ...patch } as OrderItem;
    setItems(next);
  }
  function removeItem(i: number) { setItems(items.filter((_, idx) => idx !== i)); }
  function clearAll() { setItems([]); }

  const totalQty = items.reduce((s, it) => s + (it.qty || 0), 0);

  return (
    <div className="h-full grid grid-cols-[1fr_1fr]">
      {/* 左:订单项构造 */}
      <section className="border-r border-slate-200 overflow-y-auto p-8">
        <header className="flex items-end justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
              <ShoppingCart size={22} className="text-brand-500" /> 订单 BOM 计算
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              拼一个临时订单(单品 + 套餐 + 数量 + 渠道),右侧实时汇总最终物料
            </p>
          </div>
          {items.length > 0 && (
            <button className="btn-ghost" onClick={clearAll}>
              <Trash2 size={14} /> 清空
            </button>
          )}
        </header>

        {/* 添加 */}
        <div className="space-y-3 mb-6">
          <div>
            <label className="label">添加单品</label>
            <select
              className="input mt-1"
              value=""
              onChange={(e) => { const v = parseInt(e.target.value); if (v) addProduct(v); e.target.value = ''; }}
            >
              <option value="">+ 选一个单品加入订单…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">添加套餐</label>
            <select
              className="input mt-1"
              value=""
              onChange={(e) => { const v = parseInt(e.target.value); if (v) addCombo(v); e.target.value = ''; }}
            >
              <option value="">+ 选一个套餐加入订单 (默认外卖)…</option>
              {combos.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
              ))}
            </select>
          </div>
        </div>

        {/* 已应用的共享 BOM (订单触发) */}
        {sharedHits.length > 0 && (
          <div className="card p-4 mb-4 border border-emerald-100 bg-emerald-50/40">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-slate-900 flex items-center gap-1.5 text-sm">
                <Share2 size={14} className="text-emerald-600" /> 已自动应用的共享 BOM
              </h3>
              <span className="text-xs text-slate-400">{sharedHits.length} 组触发</span>
            </div>
            <div className="space-y-2">
              {sharedHits.map((h) => (
                <div key={h.group_id} className="rounded-lg bg-white border border-emerald-100 px-3 py-2">
                  <div className="flex items-center gap-2 text-sm">
                    {h.channel === 'takeout' ? <Truck size={13} className="text-sky-500" />
                      : h.channel === 'dinein' ? <Store size={13} className="text-violet-500" />
                      : <Layers size={13} className="text-slate-500" />}
                    <span className="font-medium text-slate-900">{h.name}</span>
                    <span className="text-[10px] text-slate-400">
                      {h.channel === 'takeout' ? '· 含外卖套餐时触发'
                        : h.channel === 'dinein' ? '· 含到店套餐时触发'
                        : '· 任何订单触发'}
                    </span>
                    <span className="ml-auto chip bg-emerald-50 text-emerald-700 border border-emerald-100 text-[10px]">{h.lines.length} 行</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {h.lines.map((ln) => (
                      <span key={ln.material_code} className="text-[11px] text-slate-600 bg-slate-100 rounded px-1.5 py-0.5 font-mono">
                        {ln.material_code} ×{ln.qty}
                        {ln.substitutes.length > 0 && (
                          <span className="text-amber-600 ml-1">+{ln.substitutes.length}替</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 已选项 */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-900">订单项</h3>
            <span className="text-xs text-slate-400">{items.length} 项 · 共 {totalQty} 份</span>
          </div>
          {items.length === 0 ? (
            <div className="h-32 flex items-center justify-center text-sm text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
              🛒 上面下拉选单品/套餐加入订单
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-400 uppercase">
                <tr>
                  <th className="text-left py-1.5 w-14">类型</th>
                  <th className="text-left py-1.5">名称</th>
                  <th className="text-left py-1.5 w-28">渠道</th>
                  <th className="text-right py-1.5 w-24">份数</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => {
                  const r = resolved[i];
                  const display = r ? `${r.name} (${r.code})` : `(已删除 #${it.id})`;
                  const missing = r?.missing;
                  return (
                    <tr key={i} className={'border-t border-slate-100 ' + (missing ? 'bg-rose-50/40' : '')}>
                      <td className="py-2">
                        {it.kind === 'product'
                          ? <span className="chip bg-amber-50 text-amber-700">单品</span>
                          : <span className="chip bg-violet-50 text-violet-700">套餐</span>}
                      </td>
                      <td className="py-2 font-medium">{display}</td>
                      <td className="py-2">
                        {it.kind === 'combo' ? (
                          <div className="flex bg-slate-100 rounded-md p-0.5 w-fit">
                            {(['takeout', 'dinein'] as Channel[]).map((c) => (
                              <button
                                key={c}
                                onClick={() => updateItem(i, { channel: c })}
                                className={
                                  'flex items-center gap-1 px-2 py-0.5 text-[11px] rounded ' +
                                  (it.channel === c ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-500')
                                }
                              >
                                {c === 'takeout' ? <Truck size={11} /> : <Store size={11} />}
                                {c === 'takeout' ? '外卖' : '到店'}
                              </button>
                            ))}
                          </div>
                        ) : <span className="text-xs text-slate-300">—</span>}
                      </td>
                      <td className="py-2">
                        <input
                          type="number" min="1" step="1"
                          className="input text-right ml-auto w-20"
                          value={it.qty}
                          onChange={(e) => {
                            const v = parseInt(e.target.value);
                            updateItem(i, { qty: isNaN(v) ? 0 : v });
                          }}
                        />
                      </td>
                      <td className="py-2 text-right">
                        <button className="btn-danger !p-1" onClick={() => removeItem(i)}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* 右:汇总 BOM */}
      <section className="overflow-y-auto p-8 bg-slate-50">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900 flex items-center gap-2">
            <Sigma size={20} className="text-brand-500" /> 汇总 BOM
            {loading && <span className="text-xs text-slate-400 font-normal">计算中…</span>}
          </h2>
          <span className="text-xs text-slate-400">{bom.length} 行</span>
        </header>

        {items.length === 0 ? (
          <div className="card p-8 text-center text-sm text-slate-400">
            <Package size={32} className="mx-auto text-slate-300 mb-2" />
            订单为空,左侧添加项即可看到汇总
          </div>
        ) : bom.length === 0 ? (
          <div className="card p-8 text-center text-sm text-slate-400">无 BOM 数据</div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="text-left px-4 py-2 w-20">优先级</th>
                  <th className="text-left px-4 py-2">类别</th>
                  <th className="text-left px-4 py-2">编码</th>
                  <th className="text-left px-4 py-2">名称</th>
                  <th className="text-right px-4 py-2 w-20">数量</th>
                  <th className="text-left px-4 py-2 w-14">单位</th>
                </tr>
              </thead>
              <tbody>
                {bom.map((r) => (
                  <tr key={`${r.item_code}|${r.priority}`}
                      className={'border-t border-slate-100 '
                        + (r.priority > 0 ? 'bg-amber-50/30 ' : '')
                        + (r.is_shared ? 'bg-emerald-50/40 ' : '')}>
                    <td className="px-4 py-1.5">
                      <div className="flex flex-wrap items-center gap-1">
                        {r.priority === 0
                          ? <span className="chip bg-brand-50 text-brand-700 border border-brand-100">主</span>
                          : <span className="chip bg-amber-50 text-amber-700 border border-amber-100">替 P{r.priority}</span>}
                        {r.is_shared && (
                          <span className="chip bg-emerald-50 text-emerald-700 border border-emerald-100" title="订单级共享物料命中">共享</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-1.5">
                      {r.category === 'packaging' && <span className="chip-pkg-to">包材</span>}
                      {r.category === 'sauce'     && <span className="chip-sauce">酱料</span>}
                      {r.category === 'raw'       && <span className="chip-raw">原料</span>}
                      {r.category === 'other'     && <span className="chip bg-slate-100 text-slate-500">未分类</span>}
                    </td>
                    <td className="px-4 py-1.5 font-mono text-xs text-slate-600">{r.item_code}</td>
                    <td className="px-4 py-1.5 font-medium">{r.item_name}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{Math.round(r.qty * 1000) / 1000}</td>
                    <td className="px-4 py-1.5 text-slate-500">{r.uom || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
