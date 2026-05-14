export type Channel = 'takeout' | 'dinein';
export type Category = 'raw' | 'packaging' | 'sauce';

export interface Material {
  item_code: string;
  item_name: string;
  uom: string | null;
  category: Category;
  channel: Channel | null;
  source: 'manual' | 'erp';
  updated_at: string;
}

export interface ProductLine {
  id?: number;
  material_code: string;
  qty: number;
  item_name?: string;
  uom?: string | null;
  category?: Category;
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

export interface ComboLine {
  id?: number;
  product_id: number;
  qty: number;
  product_code?: string;
  product_name?: string;
}

export interface Combo {
  id: number;
  code: string;
  name: string;
  description: string | null;
  packaging_takeout_code: string | null;
  packaging_dinein_code: string | null;
  sauce_takeout_code: string | null;
  sauce_dinein_code: string | null;
  created_at: string;
  line_count?: number;
  lines?: ComboLine[];
}

export interface BomRow extends Material {
  qty: number;
}

export interface ComboBom {
  combo_id: number;
  channel: Channel;
  packaging_code: string | null;
  sauce_code: string | null;
  products: { product_id: number; code: string; name: string; combo_qty: number }[];
  bom: BomRow[];
}
