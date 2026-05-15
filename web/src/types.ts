export type Channel = 'takeout' | 'dinein';
export type Category = 'raw' | 'packaging' | 'sauce' | 'other';

export interface Material {
  item_code: string;
  item_name: string;
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
  uom?: string | null;
  category?: Category;
}

export interface ProductLine {
  id?: number;
  material_code: string;
  qty: number;
  item_name?: string;
  uom?: string | null;
  category?: Category;
  substitutes?: ProductLineSubstitute[];
}

export interface Product {
  id: number;
  code: string;
  name: string;
  description: string | null;
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

export interface Combo {
  id: number;
  code: string;
  name: string;
  description: string | null;
  packaging_takeout_codes: string[];
  packaging_dinein_codes:  string[];
  sauce_takeout_codes:     string[];
  sauce_dinein_codes:      string[];
  created_at: string;
  line_count?: number;
  lines?: ComboLine[];
}

export interface BomRow extends Material {
  qty: number;
  priority: number;  // 0=主物料,>=1=替换品
}

export interface ComboBom {
  combo_id: number;
  channel: Channel;
  packaging_codes: string[];
  sauce_codes: string[];
  products: { product_id: number; code: string; name: string; combo_qty: number }[];
  bom: BomRow[];
}
