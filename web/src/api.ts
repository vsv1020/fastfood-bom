import type {
  Material, Product, Combo, ComboBom, Channel, Category, BomRow,
  SharedBomGroup, SharedBomLine, Folder,
} from './types';

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!r.ok) {
    let msg = `${r.status}`;
    try { msg = (await r.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

export const api = {
  // materials
  listMaterials: (params: { category?: Category; channel?: Channel; q?: string } = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null && v !== '') as [string, string][]
    ).toString();
    return http<Material[]>(`/api/materials${q ? `?${q}` : ''}`);
  },
  createMaterial: (m: Partial<Material>) =>
    http<Material>('/api/materials', { method: 'POST', body: JSON.stringify(m) }),
  updateMaterial: (code: string, m: Partial<Material>) =>
    http<Material>(`/api/materials/${encodeURIComponent(code)}`, { method: 'PUT', body: JSON.stringify(m) }),
  deleteMaterial: (code: string) =>
    http<{ ok: true }>(`/api/materials/${encodeURIComponent(code)}`, { method: 'DELETE' }),
  dedupeMaterials: (dryRun = false) =>
    http<{
      dry_run: boolean; groups: number; removed: number; refs_migrated: number;
      actions: { name: string; category: string; keep: string; dropped: string[] }[];
    }>(`/api/materials/dedupe${dryRun ? '?dry_run=1' : ''}`, { method: 'POST' }),
  bulkUpdateMaterials: (item_codes: string[], updates: { category?: Category; channel?: Channel | null }) =>
    http<{ updated: number; note?: string }>(
      '/api/materials/bulk-update',
      { method: 'POST', body: JSON.stringify({ item_codes, ...updates }) }
    ),
  bulkDeleteMaterials: (item_codes: string[]) =>
    http<{ deleted: number; blocked: { item_code: string; reason: string }[] }>(
      '/api/materials/bulk-delete',
      { method: 'POST', body: JSON.stringify({ item_codes }) }
    ),
  splitChannel: (dryRun = false) =>
    http<{
      dry_run: boolean; scanned: number; untouched: number;
      takeout: { count: number; items: { item_code: string; item_name: string; category: string }[] };
      dinein:  { count: number; items: { item_code: string; item_name: string; category: string }[] };
    }>(`/api/materials/split-channel${dryRun ? '?dry_run=1' : ''}`, { method: 'POST' }),
  autoClassify: (dryRun = false) =>
    http<{
      dry_run: boolean; scanned: number;
      sauce:     { count: number; samples: { item_code: string; item_name: string }[]; items?: { item_code: string; item_name: string }[] };
      packaging: { count: number; samples: { item_code: string; item_name: string }[]; items?: { item_code: string; item_name: string }[] };
    }>(`/api/materials/auto-classify${dryRun ? '?dry_run=1' : ''}`, { method: 'POST' }),

  // products
  listProducts: () => http<Product[]>('/api/products'),
  getProduct: (id: number) => http<Product>(`/api/products/${id}`),
  createProduct: (p: Partial<Product>) =>
    http<Product>('/api/products', { method: 'POST', body: JSON.stringify(p) }),
  updateProduct: (id: number, p: Partial<Product>) =>
    http<Product>(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify(p) }),
  deleteProduct: (id: number) =>
    http<{ ok: true }>(`/api/products/${id}`, { method: 'DELETE' }),

  // combos
  listCombos: () => http<Combo[]>('/api/combos'),
  getCombo: (id: number) => http<Combo>(`/api/combos/${id}`),
  createCombo: (c: Partial<Combo>) =>
    http<Combo>('/api/combos', { method: 'POST', body: JSON.stringify(c) }),
  updateCombo: (id: number, c: Partial<Combo>) =>
    http<Combo>(`/api/combos/${id}`, { method: 'PUT', body: JSON.stringify(c) }),
  deleteCombo: (id: number) =>
    http<{ ok: true }>(`/api/combos/${id}`, { method: 'DELETE' }),
  comboBom: (id: number, channel: Channel) =>
    http<ComboBom>(`/api/combos/${id}/bom?channel=${channel}`),

  // folders (文件夹树:kind = product | combo)
  listFolders: (kind: 'product' | 'combo') =>
    http<Folder[]>(`/api/folders?kind=${kind}`),
  createFolder: (f: { kind: 'product' | 'combo'; name: string; parent_id?: number | null }) =>
    http<Folder>('/api/folders', { method: 'POST', body: JSON.stringify(f) }),
  updateFolder: (id: number, f: { name?: string; parent_id?: number | null }) =>
    http<Folder>(`/api/folders/${id}`, { method: 'PUT', body: JSON.stringify(f) }),
  deleteFolder: (id: number) =>
    http<{ ok: true }>(`/api/folders/${id}`, { method: 'DELETE' }),

  // erp
  getErpSettings: () => http<{
    url: string; api_key: string; api_secret_set: boolean;
    item_group: string; name_field: string;
    whitelist: string; whitelist_count: number; whitelist_strict: boolean;
  }>('/api/erp/settings'),
  saveErpSettings: (s: {
    url?: string; api_key?: string; api_secret?: string;
    item_group?: string; name_field?: string;
    whitelist?: string; whitelist_strict?: boolean;
  }) =>
    http<{ ok: true }>('/api/erp/settings', { method: 'PUT', body: JSON.stringify(s) }),
  // ----- 订单维度 BOM -----
  orderPreview: (items: { kind: 'product' | 'combo'; id: number; qty: number; channel?: Channel }[]) =>
    http<{
      items: { kind: string; id: number; code?: string; name?: string; qty: number; channel?: Channel; missing?: boolean }[];
      bom: BomRow[];
      total_lines: number;
      shared_hits: { id: number; name: string; material_code: string; qty: number; channel: Channel | null }[];
    }>('/api/orders/preview', { method: 'POST', body: JSON.stringify({ items }) }),

  // ----- 订单级共享 BOM 组 (固定: 外卖共有 / 到店共有 / 通用共有) -----
  listSharedBomGroups: () => http<SharedBomGroup[]>('/api/shared-boms'),
  updateSharedBomGroup: (id: number, s: { name?: string; enabled?: boolean; lines?: SharedBomLine[] }) =>
    http<SharedBomGroup>(`/api/shared-boms/${id}`, { method: 'PUT', body: JSON.stringify(s) }),

  syncErp: () => http<{
    count: number; note?: string;
    name_field: string; name_field_requested: string; name_field_used: boolean;
    name_missing: number;
    whitelist_used: boolean; whitelist_size: number;
    strict_mode: boolean; strict_purged: number;
    strict_blocked: { item_code: string; reason: string }[];
  }>('/api/erp/sync', { method: 'POST' }),
};
