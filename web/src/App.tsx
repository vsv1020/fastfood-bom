import { useState } from 'react';
import { Boxes, Sandwich, PackageOpen, Settings as SettingsIcon, type LucideIcon } from 'lucide-react';
import MaterialsPage from './pages/Materials';
import ProductsPage from './pages/Products';
import CombosPage from './pages/Combos';
import SettingsPage from './pages/Settings';

type Tab = 'materials' | 'products' | 'combos' | 'settings';

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'materials', label: '物料库',   icon: Boxes },
  { id: 'products',  label: '单品 BOM', icon: Sandwich },
  { id: 'combos',    label: '套餐组合', icon: PackageOpen },
  { id: 'settings',  label: '设置',     icon: SettingsIcon },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('materials');

  return (
    <div className="min-h-screen flex">
      {/* Side nav */}
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white px-3 py-5 flex flex-col">
        <div className="px-3 mb-6 flex items-center gap-2">
          <span className="text-2xl">🍔</span>
          <div>
            <div className="text-sm font-semibold text-slate-900">快餐 BOM</div>
            <div className="text-[11px] text-slate-500">配置中心</div>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {TABS.map(({ id, label, icon: Icon }) => (
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
              {label}
            </button>
          ))}
        </nav>
        <div className="mt-auto px-3 text-[10px] text-slate-400">
          v0.1 · BOM aggregation engine
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        {tab === 'materials' && <MaterialsPage />}
        {tab === 'products'  && <ProductsPage />}
        {tab === 'combos'    && <CombosPage />}
        {tab === 'settings'  && <SettingsPage />}
      </main>
    </div>
  );
}
