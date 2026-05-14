import type {
  Material, Product, Combo, ComboBom, Channel, Category,
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

  // erp
  getErpSettings: () => http<{
    url: string; api_key: string; api_secret_set: boolean;
    item_group: string; name_field: string;
  }>('/api/erp/settings'),
  saveErpSettings: (s: {
    url?: string; api_key?: string; api_secret?: string;
    item_group?: string; name_field?: string;
  }) =>
    http<{ ok: true }>('/api/erp/settings', { method: 'PUT', body: JSON.stringify(s) }),
  syncErp: () => http<{
    count: number; note?: string;
    name_field: string; name_field_requested: string; name_field_used: boolean;
    name_missing: number;
  }>('/api/erp/sync', { method: 'POST' }),
};
