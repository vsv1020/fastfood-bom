export type Channel = 'takeout' | 'dinein';
export type Category = 'raw' | 'packaging' | 'sauce' | 'other';

export interface Material {
  item_code: string;
  item_name: string;          // 中文主名
  name_en?: string | null;
  name_th?: string | null;
  uom: string | null;
  category: Category;
  channel: Channel | null;
  source: 'manual' | 'erp';
  updated_at: string;
}

export interface ProductLineSubstitute {
  id?: number;
  material_code: string;
  qty: number;
  priority: number;
  item_name?: string;
  name_en?: string | null;
  name_th?: string | null;
  uom?: string | null;
  category?: Category;
}

export interface ProductLine {
  id?: number;
  material_code: string;
  qty: number;
  item_name?: string;
  name_en?: string | null;
  name_th?: string | null;
  uom?: string | null;
  category?: Category;
  substitutes?: ProductLineSubstitute[];
}

export interface Folder {
  id: number;
  kind: 'product' | 'combo';
  name: string;
  parent_id: number | null;
  created_at: string;
}

export interface Product {
  id: number;
  code: string;
  name: string;             // 中文主名
  name_en?: string | null;
  name_th?: string | null;
  description: string | null;
  folder_id?: number | null;
  created_at: string;
  line_count?: number;
  lines?: ProductLine[];
}

export interface ComboLineSubstitute {
  id?: number;
  product_id: number;
  qty: number;
  priority: number;
  product_code?: string;
  product_name?: string;
}

export interface ComboLine {
  id?: number;
  product_id: number;
  qty: number;
  product_code?: string;
  product_name?: string;
  substitutes?: ComboLineSubstitute[];
}

export interface PackEntry { code: string; qty: number; }

export interface Combo {
  id: number;
  code: string;
  name: string;             // 中文主名
  name_en?: string | null;
  name_th?: string | null;
  description: string | null;
  packaging_takeout_codes: PackEntry[];
  packaging_dinein_codes:  PackEntry[];
  sauce_takeout_codes:     PackEntry[];
  sauce_dinein_codes:      PackEntry[];
  folder_id?: number | null;
  created_at: string;
  line_count?: number;
  lines?: ComboLine[];
}

export interface BomRow extends Material {
  qty: number;
  priority: number;  // 0=主物料,>=1=替换品
  is_shared?: boolean;  // 命中订单级共享 BOM
}

export interface SharedBomLineSubstitute {
  id?: number;
  material_code: string;
  qty: number;
  priority: number;
  item_name?: string;
  uom?: string | null;
  category?: Category;
}

export interface SharedBomLine {
  id?: number;
  material_code: string;
  qty: number;
  item_name?: string;
  uom?: string | null;
  category?: Category;
  substitutes?: SharedBomLineSubstitute[];
}

export interface SharedBomGroup {
  id: number;
  code: string;            // 'takeout' | 'dinein' | 'all'
  name: string;
  channel: Channel | null;
  enabled: number;
  created_at: string;
  lines: SharedBomLine[];
}

export interface ComboBom {
  combo_id: number;
  channel: Channel;
  packaging_codes: string[];   // 兼容字段
  sauce_codes: string[];
  packaging_entries: PackEntry[];
  sauce_entries:     PackEntry[];
  products: { product_id: number; code: string; name: string; combo_qty: number }[];
  bom: BomRow[];
}
