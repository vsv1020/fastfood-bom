import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { useT } from '../i18n';
import type { MarginResponse, MarginChannel } from '../types';

const pct = (m: number | null) => (m == null ? '—' : `${(m * 100).toFixed(1)}%`);
const money = (x: number) => x.toFixed(2);

export default function MarginPage() {
  const t = useT();
  const [data, setData] = useState<MarginResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      setData(await api.getMargins());
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  function doExport() {
    const url = `/api/export/margins.csv?_t=${Date.now()}`;
    const a = document.createElement('a');
    a.href = url;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function syncPrices() {
    setSyncing(true);
    try {
      const r = await api.syncPrices();
      alert(
        t('margin.sync_done')
          .replace('{matched}', String(r.matched))
          .replace('{missing}', String(r.missing_count))
      );
      await load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSyncing(false);
    }
  }

  // 渠道单元格:售价 / 成本(缺价标红 + tooltip)/ 毛利率
  function priceCell(ch: MarginChannel) {
    return ch.price == null
      ? <span className="text-slate-400">{t('margin.no_price')}</span>
      : <span className="tabular-nums">{money(ch.price)}</span>;
  }
  function costCell(ch: MarginChannel) {
    const tip = ch.complete ? undefined : t('margin.missing_prefix') + ch.missing.map((m) => m.item_name).join('、');
    return (
      <span className={'tabular-nums ' + (ch.complete ? 'text-slate-700' : 'text-rose-600 font-medium')} title={tip}>
        {money(ch.cost)}
        {!ch.complete && <span className="ml-1 text-[10px] text-rose-500">⚠</span>}
      </span>
    );
  }
  function marginCell(ch: MarginChannel) {
    return <span className="tabular-nums font-medium text-slate-800">{pct(ch.margin)}</span>;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-8 max-w-6xl mx-auto">
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{t('margin.title')}</h1>
            <p className="text-sm text-slate-500 mt-1">{t('margin.subtitle')}</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button className="btn-outline" onClick={syncPrices} disabled={syncing}>
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
              {t('margin.sync_prices')}
            </button>
            <button className="btn-primary" onClick={doExport}>
              <Download size={14} /> {t('btn.export')}
            </button>
          </div>
        </header>

        {data && (
          <div className="mb-4 rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-[12px] text-slate-600">
            <div className="flex gap-4 font-medium text-slate-700 mb-1">
              {data.tax_rates_in_use.length > 0 && (
                <span>{t('margin.tax_rate')}: {data.tax_rates_in_use.map((r) => `${(r * 100).toFixed(0)}%`).join('、')}</span>
              )}
              <span>{t('margin.markup')}: {(data.markup * 100).toFixed(0)}%</span>
            </div>
            <div>{t('margin.formula').replace('{markup}', (data.markup * 100).toFixed(0))}</div>
          </div>
        )}

        {err && <div className="mb-4 text-rose-600 text-sm">{err}</div>}
        {loading && <div className="text-sm text-slate-400">…</div>}

        {data && (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-100">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">{t('margin.col.code')}</th>
                  <th className="text-left px-4 py-2.5 font-medium">{t('margin.col.name')}</th>
                  <th className="text-left px-4 py-2.5 font-medium">{t('margin.col.folder')}</th>
                  <th className="text-right px-4 py-2.5 font-medium">{t('margin.col.to_price')}</th>
                  <th className="text-right px-4 py-2.5 font-medium">{t('margin.col.to_cost')}</th>
                  <th className="text-right px-4 py-2.5 font-medium">{t('margin.col.to_margin')}</th>
                  <th className="text-right px-4 py-2.5 font-medium border-l border-slate-100">{t('margin.col.di_price')}</th>
                  <th className="text-right px-4 py-2.5 font-medium">{t('margin.col.di_cost')}</th>
                  <th className="text-right px-4 py-2.5 font-medium">{t('margin.col.di_margin')}</th>
                </tr>
              </thead>
              <tbody>
                {data.combos.map((r) => (
                  <tr key={r.combo_id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500">{r.code}</td>
                    <td className="px-4 py-2.5 text-slate-900">{r.name}</td>
                    <td className="px-4 py-2.5 text-slate-400 text-[12px]">{r.folder || '—'}</td>
                    <td className="px-4 py-2.5 text-right">{priceCell(r.takeout)}</td>
                    <td className="px-4 py-2.5 text-right">{costCell(r.takeout)}</td>
                    <td className="px-4 py-2.5 text-right">{marginCell(r.takeout)}</td>
                    <td className="px-4 py-2.5 text-right border-l border-slate-100">{priceCell(r.dinein)}</td>
                    <td className="px-4 py-2.5 text-right">{costCell(r.dinein)}</td>
                    <td className="px-4 py-2.5 text-right">{marginCell(r.dinein)}</td>
                  </tr>
                ))}
                {data.combos.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">{t('margin.empty')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
