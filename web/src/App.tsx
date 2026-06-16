import { useState } from 'react';
import { Boxes, Sandwich, PackageOpen, ShoppingCart, Share2, Settings as SettingsIcon, TrendingUp, Globe, LogOut, type LucideIcon } from 'lucide-react';
import MaterialsPage from './pages/Materials';
import ProductsPage from './pages/Products';
import CombosPage from './pages/Combos';
import OrdersPage from './pages/Orders';
import SharedBomsPage from './pages/SharedBoms';
import MarginPage from './pages/Margin';
import SettingsPage from './pages/Settings';
import { useT, useLang, LANG_OPTIONS, type Lang } from './i18n';

type Tab = 'materials' | 'products' | 'combos' | 'orders' | 'shared' | 'margin' | 'settings';

const TABS: { id: Tab; tkey: string; icon: LucideIcon }[] = [
  { id: 'materials', tkey: 'nav.materials', icon: Boxes },
  { id: 'products',  tkey: 'nav.products',  icon: Sandwich },
  { id: 'combos',    tkey: 'nav.combos',    icon: PackageOpen },
  { id: 'shared',    tkey: 'nav.shared',    icon: Share2 },
  { id: 'orders',    tkey: 'nav.orders',    icon: ShoppingCart },
  { id: 'margin',    tkey: 'nav.margin',    icon: TrendingUp },
  { id: 'settings',  tkey: 'nav.settings',  icon: SettingsIcon },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('materials');
  const t = useT();
  const { lang, setLang } = useLang();

  return (
    <div className="h-screen flex">
      {/* Side nav */}
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white px-3 py-5 flex flex-col">
        <div className="px-3 mb-6 flex items-center gap-2">
          <span className="text-2xl">🍔</span>
          <div>
            <div className="text-sm font-semibold text-slate-900">{t('brand.title')}</div>
            <div className="text-[11px] text-slate-500">{t('brand.subtitle')}</div>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {TABS.map(({ id, tkey, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ' +
                (tab === id
                  ? 'bg-brand-50 text-brand-700 font-semibold'
                  : 'text-slate-600 hover:bg-slate-50')
              }
            >
              <Icon size={16} />
              {t(tkey)}
            </button>
          ))}
        </nav>
        <div className="mt-auto">
          <button
            className="w-full text-left flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 mb-2"
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
              location.reload();
            }}
          >
            <LogOut size={14} /> {t('login.logout')}
          </button>
          <div className="px-3 mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-400">
            <Globe size={11} /> Language
          </div>
          <div className="px-3 flex gap-1">
            {LANG_OPTIONS.map((l) => (
              <button
                key={l.value}
                onClick={() => setLang(l.value as Lang)}
                className={
                  'flex-1 text-xs rounded-md py-1 transition ' +
                  (lang === l.value
                    ? 'bg-brand-500 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200')
                }
                title={l.label}
              >
                {l.flag} {l.label}
              </button>
            ))}
          </div>
          <div className="px-3 mt-3 text-[10px] text-slate-400">
            v0.1 · BOM aggregation engine
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 min-h-0 overflow-hidden">
        {tab === 'materials' && <MaterialsPage />}
        {tab === 'products'  && <ProductsPage />}
        {tab === 'combos'    && <CombosPage />}
        {tab === 'shared'    && <SharedBomsPage />}
        {tab === 'orders'    && <OrdersPage />}
        {tab === 'margin'    && <MarginPage />}
        {tab === 'settings'  && <SettingsPage />}
      </main>
    </div>
  );
}
