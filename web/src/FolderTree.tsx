import { useState, type ReactNode } from 'react';
import {
  ChevronRight, ChevronDown, Folder as FolderIcon, FolderPlus,
  Plus, Pencil, Trash2, Download, X,
} from 'lucide-react';
import type { Folder } from './types';
import { api } from './api';
import { useT } from './i18n';

/** 一条树里的条目 (单品 或 套餐),由各页面映射后传入 */
export interface TreeItemData {
  id: number;
  folder_id: number | null;
  name: string;
  code: string;
  meta: string;
}

/** 把 folder 列表拍平成带缩进 label 的数组,用于 <select> 下拉 */
export function flattenFolders(
  folders: Folder[], parentId: number | null = null, depth = 0,
): { id: number; label: string }[] {
  const out: { id: number; label: string }[] = [];
  for (const f of folders.filter((x) => x.parent_id === parentId)) {
    out.push({ id: f.id, label: '　'.repeat(depth) + f.name });
    out.push(...flattenFolders(folders, f.id, depth + 1));
  }
  return out;
}

export function FolderTree({
  kind, title, exportHref, folders, items,
  selectedItemId, checked,
  onSelectItem, onToggleCheck, onCheckAll, onClearChecks, onBulkDelete,
  onNewItem, onReload,
}: {
  kind: 'product' | 'combo';
  title: string;
  exportHref: string;
  folders: Folder[];
  items: TreeItemData[];
  selectedItemId: number | null;
  checked: Set<number>;
  onSelectItem: (id: number) => void;
  onToggleCheck: (id: number) => void;
  onCheckAll: () => void;
  onClearChecks: () => void;
  onBulkDelete: () => void;
  onNewItem: (folderId: number | null) => void;
  onReload: () => void;
}) {
  const t = useT();
  // 默认全部展开:只记录被显式折叠的 folder,新建的 folder 自动展开
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // 导出:scope = 'all' 全部 / 'ungrouped' 未归类 / 数字 = 该文件夹及子文件夹
  function doExport(scope: 'all' | 'ungrouped' | number) {
    let url = exportHref;
    if (scope === 'ungrouped') url += '?folder_id=ungrouped';
    else if (scope !== 'all') url += `?folder_id=${scope}`;
    const a = document.createElement('a');
    a.href = url;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setExportOpen(false);
  }

  const childFolders = (pid: number | null) => folders.filter((f) => f.parent_id === pid);
  const itemsIn = (fid: number | null) => items.filter((i) => i.folder_id === fid);

  function toggle(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function guard(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e: any) { alert(e?.message || String(e)); }
    finally { setBusy(false); }
  }
  function newFolder(parentId: number | null) {
    const name = prompt(t('folder.name_prompt'));
    if (!name || !name.trim()) return;
    guard(async () => { await api.createFolder({ kind, name: name.trim(), parent_id: parentId }); onReload(); });
  }
  function renameFolder(f: Folder) {
    const name = prompt(t('folder.rename_prompt'), f.name);
    if (!name || !name.trim() || name.trim() === f.name) return;
    guard(async () => { await api.updateFolder(f.id, { name: name.trim() }); onReload(); });
  }
  function deleteFolder(f: Folder) {
    if (!confirm(t('folder.delete_confirm'))) return;
    guard(async () => { await api.deleteFolder(f.id); onReload(); });
  }

  function renderItem(it: TreeItemData, depth: number) {
    return (
      <div
        key={`it-${it.id}`}
        className={
          'group flex items-center gap-2 py-2 border-b border-slate-100 hover:bg-slate-50 cursor-pointer ' +
          (checked.has(it.id) ? 'bg-brand-50/40 ' : '') +
          (selectedItemId === it.id ? 'bg-brand-50/60 border-l-2 border-l-brand-500' : '')
        }
        style={{ paddingLeft: 12 + depth * 16, paddingRight: 12 }}
        onClick={() => onSelectItem(it.id)}
      >
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-300 shrink-0"
          checked={checked.has(it.id)}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleCheck(it.id)}
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-slate-900 truncate">{it.name}</div>
          <div className="flex items-center justify-between mt-0.5">
            <span className="text-[11px] font-mono text-slate-500">{it.code}</span>
            <span className="text-[11px] text-slate-400">{it.meta}</span>
          </div>
        </div>
      </div>
    );
  }

  function renderFolder(f: Folder, depth: number): ReactNode {
    const open = !collapsed.has(f.id);
    const subs = childFolders(f.id);
    const its = itemsIn(f.id);
    return (
      <div key={`f-${f.id}`}>
        <div
          className="group flex items-center gap-1 py-1.5 border-b border-slate-100 hover:bg-slate-50 cursor-pointer select-none"
          style={{ paddingLeft: 6 + depth * 16, paddingRight: 6 }}
          onClick={() => toggle(f.id)}
        >
          <span className="shrink-0 text-slate-400">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <FolderIcon size={14} className="shrink-0 text-amber-500" />
          <span
            className="text-sm font-medium text-slate-800 truncate flex-1"
            title={f.name}
            onDoubleClick={(e) => { e.stopPropagation(); renameFolder(f); }}
          >
            {f.name}
          </span>
          <span className="text-[11px] text-slate-400 shrink-0 group-hover:hidden">{its.length}</span>
          <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
            <button className="p-1 rounded hover:bg-brand-100 text-slate-500"
              title={t('folder.new_item_here')}
              onClick={(e) => { e.stopPropagation(); onNewItem(f.id); }}>
              <Plus size={13} />
            </button>
            <button className="p-1 rounded hover:bg-brand-100 text-slate-500"
              title={t('folder.new_sub')}
              onClick={(e) => { e.stopPropagation(); newFolder(f.id); }}>
              <FolderPlus size={13} />
            </button>
            <button className="p-1 rounded hover:bg-brand-100 text-slate-500"
              title={t('folder.rename')}
              onClick={(e) => { e.stopPropagation(); renameFolder(f); }}>
              <Pencil size={13} />
            </button>
            <button className="p-1 rounded hover:bg-rose-100 text-rose-500"
              title={t('folder.delete')}
              onClick={(e) => { e.stopPropagation(); deleteFolder(f); }}>
              <Trash2 size={13} />
            </button>
          </div>
        </div>
        {open && (
          <>
            {subs.map((s) => renderFolder(s, depth + 1))}
            {its.map((it) => renderItem(it, depth + 1))}
          </>
        )}
      </div>
    );
  }

  const ungrouped = itemsIn(null);

  return (
    <>
      <header className={
        'relative p-3 border-b flex items-center gap-2 ' +
        (checked.size > 0 ? 'border-brand-100 bg-brand-50/70' : 'border-slate-100')
      }>
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-300 ml-1"
          checked={items.length > 0 && checked.size === items.length}
          ref={(el) => { if (el) el.indeterminate = checked.size > 0 && checked.size < items.length; }}
          onChange={() => { if (checked.size === items.length) onClearChecks(); else onCheckAll(); }}
          title={t('btn.select_all')}
        />
        {checked.size > 0 ? (
          <>
            <span className="text-sm font-semibold text-brand-700">{t('meta.also_selected')} {checked.size}</span>
            <button className="btn-danger !py-1 !px-2 ml-auto" onClick={onBulkDelete} title={t('btn.delete')}>
              <Trash2 size={14} /> {t('btn.delete')}
            </button>
            <button className="btn-ghost !py-1 !px-1.5" onClick={onClearChecks} title={t('btn.cancel')}>
              <X size={14} />
            </button>
          </>
        ) : (
          <>
            <div className="ml-1">
              <div className="text-sm font-semibold text-slate-900">{title}</div>
              <div className="text-[11px] text-slate-500">{items.length} {t('meta.n_units')}</div>
            </div>
            <button className="btn-ghost !py-1 !px-2 ml-auto" onClick={() => setExportOpen((v) => !v)} title={t('btn.export')}>
              <Download size={14} />
            </button>
            <button className="btn-ghost !py-1 !px-2" onClick={() => newFolder(null)} title={t('folder.new')}>
              <FolderPlus size={14} />
            </button>
            <button className="btn-primary !py-1 !px-2" onClick={() => onNewItem(null)}>
              <Plus size={14} /> {t('btn.new')}
            </button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                <div className="absolute right-2 top-full mt-1 z-20 w-56 bg-white rounded-lg shadow-lg border border-slate-200 py-1 max-h-72 overflow-y-auto">
                  <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-slate-400">{t('btn.export')}</div>
                  <button
                    className="block w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                    onClick={() => doExport('all')}
                  >
                    {t('export.all')}
                  </button>
                  {flattenFolders(folders).map((f) => (
                    <button
                      key={f.id}
                      className="block w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 truncate"
                      onClick={() => doExport(f.id)}
                    >
                      📁 {f.label}
                    </button>
                  ))}
                  {itemsIn(null).length > 0 && (
                    <button
                      className="block w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                      onClick={() => doExport('ungrouped')}
                    >
                      {t('folder.ungrouped')}
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </header>
      <div className="flex-1 overflow-y-auto">
        {childFolders(null).map((f) => renderFolder(f, 0))}
        {ungrouped.length > 0 && (
          <div>
            <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100 bg-slate-50/60">
              {t('folder.ungrouped')} · {ungrouped.length}
            </div>
            {ungrouped.map((it) => renderItem(it, 0))}
          </div>
        )}
        {folders.length === 0 && items.length === 0 && (
          <div className="p-6 text-center text-sm text-slate-400">—</div>
        )}
      </div>
    </>
  );
}
