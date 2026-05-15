import React, { useEffect, useState } from 'react';
import { Save, Truck, Store, Layers, Share2, X, Shuffle, Power, Download } from 'lucide-react';
import { api } from '../api';
import type { SharedBomGroup, SharedBomLine, SharedBomLineSubstitute, Material, Channel } from '../types';

export default function SharedBomsPage() {
  const [groups, setGroups] = useState<SharedBomGroup[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const list = await api.listSharedBomGroups();
    setGroups(list);
    if (activeId == null && list.length > 0) setActiveId(list[0].id);
  }
  useEffect(() => {
    load();
    api.listMaterials().then(setMaterials);
  }, []);

  const active = groups.find((g) => g.id === activeId) || null;

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(null), 4000); }

  return (
    <div className="h-full flex flex-col">
      <header className="px-8 pt-8 pb-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
            <Share2 size={20} className="text-brand-500" /> 订单级共享 BOM
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            每组按单品 BOM 配置方式 (主物料 + 替换品 + 优先级)。订单匹配渠道时,组内全部物料并入汇总 BOM。
          </p>
        </div>
        <a className="btn-outline" href="/api/export/shared-boms.csv" download title="导出共享 BOM 配置为 CSV">
          <Download size={14} /> 导出
        </a>
      </header>

      {msg && (
        <div className="mx-8 mb-3 rounded-lg bg-brand-50 border border-brand-100 text-brand-700 px-4 py-2 text-sm">
          {msg}
        </div>
      )}

      <div className="px-8 flex flex-wrap gap-2 mb-3">
        {groups.map((g) => (
          <button
            key={g.id}
            onClick={() => setActiveId(g.id)}
            className={
              'px-4 py-1.5 text-sm rounded-full transition flex items-center gap-1.5 ' +
              (g.id === activeId
                ? 'bg-brand-500 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:border-brand-300 hover:text-brand-600')
            }
          >
            {g.channel === 'takeout' ? <Truck size={13} /> : g.channel === 'dinein' ? <Store size={13} /> : <Layers size={13} />}
            {g.name}
            <span className={'ml-1 rounded-full px-1.5 text-[10px] ' + (g.id === activeId ? 'bg-white/20' : 'bg-slate-100 text-slate-500')}>
              {g.lines.length}
            </span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {active ? (
          <SharedBomGroupEditor
            key={active.id}
            group={active}
            materials={materials}
            onSaved={(g) => { flash(`「${g.name}」已保存 (${g.lines.length} 行物料)`); load(); }}
          />
        ) : (
          <div className="text-center text-slate-400 py-12">没有共享 BOM 组</div>
        )}
      </div>
    </div>
  );
}

function SharedBomGroupEditor({
  group, materials, onSaved,
}: {
  group: SharedBomGroup;
  materials: Material[];
  onSaved: (g: SharedBomGroup) => void;
}) {
  const [lines, setLines] = useState<SharedBomLine[]>(group.lines || []);
  const [enabled, setEnabled] = useState(!!group.enabled);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setLines(group.lines || []); setEnabled(!!group.enabled); }, [group.id]);

  function updateLine(i: number, patch: Partial<SharedBomLine>) {
    const next = [...lines]; next[i] = { ...next[i], ...patch }; setLines(next);
  }
  function addLine(code: string) {
    const m = materials.find((x) => x.item_code === code);
    if (!m || lines.some((l) => l.material_code === code)) return;
    setLines([...lines, {
      material_code: code, qty: 1,
      item_name: m.item_name, uom: m.uom, category: m.category,
      substitutes: [],
    }]);
  }
  function addSub(i: number, code: string) {
    const m = materials.find((x) => x.item_code === code);
    if (!m) return;
    const subs = lines[i].substitutes || [];
    if (subs.some((s) => s.material_code === code)) return;
    if (lines[i].material_code === code) return;
    const nextPri = (subs.reduce((mx, s) => Math.max(mx, s.priority), 0) || 0) + 1;
    updateLine(i, { substitutes: [...subs, {
      material_code: code, qty: 1, priority: nextPri,
      item_name: m.item_name, uom: m.uom, category: m.category,
    }] });
  }
  function updateSub(i: number, j: number, patch: Partial<SharedBomLineSubstitute>) {
    const subs = [...(lines[i].substitutes || [])];
    subs[j] = { ...subs[j], ...patch };
    updateLine(i, { substitutes: subs });
  }
  function removeSub(i: number, j: number) {
    updateLine(i, { substitutes: (lines[i].substitutes || []).filter((_, idx) => idx !== j) });
  }

  async function save() {
    setSaving(true); setErr(null);
    try {
      const r = await api.updateSharedBomGroup(group.id, {
        enabled,
        lines: lines.map((l) => ({
          material_code: l.material_code,
          qty: Number(l.qty) || 1,
          substitutes: (l.substitutes || []).map((s) => ({
            material_code: s.material_code,
            qty: Number(s.qty) || 1,
            priority: Number(s.priority) || 1,
          })),
        })),
      });
      onSaved(r);
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-slate-900 flex items-center gap-1.5">
            {group.channel === 'takeout' ? <Truck size={16} className="text-sky-500" />
              : group.channel === 'dinein' ? <Store size={16} className="text-violet-500" />
              : <Layers size={16} className="text-slate-500" />}
            {group.name}
          </h3>
          <button
            onClick={() => setEnabled(!enabled)}
            className={'inline-flex items-center gap-1 text-xs rounded px-2 py-1 ' + (enabled
              ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}
            title={enabled ? '点击停用此组' : '点击启用此组'}
          >
            <Power size={11} /> {enabled ? '已启用' : '已停用'}
          </button>
          <span className="text-xs text-slate-400">
            {group.channel === 'takeout' && '订单含 ≥1 外卖套餐时触发'}
            {group.channel === 'dinein'  && '订单含 ≥1 到店套餐时触发'}
            {!group.channel && '任何非空订单触发'}
          </span>
        </div>
        <button className="btn-primary" onClick={save} disabled={saving}>
          <Save size={14} /> 保存
        </button>
      </div>

      {err && <div className="mb-3 text-sm text-rose-600">{err}</div>}

      {lines.length === 0 ? (
        <div className="h-32 flex items-center justify-center text-sm text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
          还没有物料,从下面"添加"开始
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-400 uppercase">
            <tr>
              <th className="text-left py-1.5 pl-2 w-20">优先级</th>
              <th className="text-left py-1.5">编码</th>
              <th className="text-left py-1.5">名称</th>
              <th className="text-right py-1.5 w-28">数量</th>
              <th className="text-left py-1.5 w-14">单位</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const subs = l.substitutes || [];
              const usedCodes = new Set([l.material_code, ...subs.map((s) => s.material_code)]);
              const subOpts = materials.filter((m) => !usedCodes.has(m.item_code));
              return (
              <React.Fragment key={l.id ?? `new-${i}-${l.material_code}`}>
                <tr className="border-t-2 border-slate-200">
                  <td className="py-2 pl-2">
                    <span className="chip bg-brand-50 text-brand-700 border border-brand-100">主</span>
                  </td>
                  <td className="py-2 font-mono text-xs text-slate-600">{l.material_code}</td>
                  <td className="py-2 font-medium">{l.item_name}</td>
                  <td className="py-2">
                    <input
                      type="number" step="0.5" min="0"
                      className="input text-right ml-auto w-24"
                      value={l.qty}
                      onChange={(e) => updateLine(i, { qty: parseFloat(e.target.value) || 0 })}
                    />
                  </td>
                  <td className="py-2 text-slate-500">{l.uom || '—'}</td>
                  <td className="py-2 text-right">
                    <button className="btn-danger !p-1"
                      onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                      title="删除整行(主+替换品)">
                      <X size={14} />
                    </button>
                  </td>
                </tr>
                {subs.map((s, j) => (
                  <tr key={`s-${j}-${s.material_code}`} className="bg-slate-50/60 border-t border-slate-100">
                    <td className="py-1.5 pl-2">
                      <span className="chip bg-amber-50 text-amber-700 border border-amber-100">替 P{s.priority}</span>
                    </td>
                    <td className="py-1.5 pl-4 font-mono text-xs text-slate-500">
                      <Shuffle size={11} className="inline mr-1 -mt-0.5 text-amber-500" />
                      {s.material_code}
                    </td>
                    <td className="py-1.5 text-slate-700">{s.item_name}</td>
                    <td className="py-1.5">
                      <input
                        type="number" step="0.5" min="0"
                        className="input text-right ml-auto w-24"
                        value={s.qty}
                        onChange={(e) => updateSub(i, j, { qty: parseFloat(e.target.value) || 0 })}
                      />
                    </td>
                    <td className="py-1.5 text-slate-500">{s.uom || '—'}</td>
                    <td className="py-1.5 text-right">
                      <button className="btn-danger !p-1" onClick={() => removeSub(i, j)} title="移除该替换品">
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
                      onChange={(e) => { if (e.target.value) addSub(i, e.target.value); e.target.value = ''; }}
                    >
                      <option value="">+ 添加替换品…</option>
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

      {/* 添加新物料行 */}
      <div className="mt-4 pt-3 border-t border-slate-100">
        <select
          className="input cursor-pointer"
          value=""
          onChange={(e) => { if (e.target.value) addLine(e.target.value); e.target.value = ''; }}
        >
          <option value="">+ 添加物料行…</option>
          {materials
            .filter((m) => !lines.some((l) => l.material_code === m.item_code))
            .map((m) => (
              <option key={m.item_code} value={m.item_code}>
                {m.item_name.split('|')[0].trim()} ({m.item_code})
              </option>
            ))}
        </select>
      </div>
    </div>
  );
}
