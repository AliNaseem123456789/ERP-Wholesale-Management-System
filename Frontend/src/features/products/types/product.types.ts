// 1. The Single Source of Truth
export interface Product {
  id: string | number;
  title: string;
  brand: string;
  description?: string;
  sku?: string;
  categories?: string[];
  flavors?: string[];
  price?: number; // the logged-in customer's price (price list / group discount applied)
  /** base price, only sent when the customer's price differs */
  list_price?: number;
  /** volume prices for this customer */
  price_tiers?: { min_quantity: number; price: number }[];
  url?: string;
  created_at?: string;
  company?: CompanyBrief | null;
  /** null = seller doesn't track stock (always orderable) */
  stock_status?: "in_stock" | "out_of_stock" | "preorder" | null;
  allow_preorder?: boolean;
  incoming_stock?: Record<string, number>;
  expected_date?: string | null;
  sale?: { percent: number; label?: string | null; ends_at?: string | null; price?: number } | null;
  rating?: { average: number | null; count: number } | null;
  /** only sent to logged-in customers */
  available?: number;
  /** available per flavour (logged-in customers, sellers that track stock) */
  flavor_stock?: Record<string, number>;
  /** main image (gallery); when missing the original image path is used */
  image?: string | null;
  slug?: string;
  status?: string;
  unit?: string;
  short_description?: string | null;
  /** the whole order of this product (all variants together) must be at least this */
  min_order_qty?: number;
  /** each line must be a multiple of this (e.g. cases of 10) */
  order_multiple?: number;
  /** units inside one selling unit */
  pack_size?: number | null;
  is_featured?: boolean;
  /** product page only */
  variants?: ProductVariant[];
  images?: { id: number; url: string; alt_text?: string | null; variant_key?: string | null }[];
  specifications?: { key: string; name: string; value: string | null; unit?: string | null }[];
  category_list?: { id: number; name: string; slug: string }[];
  brand_info?: { id: number; name: string; slug: string; logo_url?: string | null } | null;
}

export interface ProductVariant {
  id: number;
  /** variant key: what the cart, stock and orders use */
  flavor: string;
  name: string;
  sku?: string | null;
  status: "active" | "discontinued" | "archived";
  min_order_qty?: number | null;
  image_url?: string | null;
  options: { key: string; name: string; value: string | null }[];
  price?: number | null;
  list_price?: number;
  price_tiers?: { min_quantity: number; price: number }[];
}

export interface CompanyBrief {
  id: number;
  name: string;
  slug: string;
  logo_url?: string | null;
}

/** * DELETE ProductWithImages.
 * We now use getProductImage(product.id) directly in the UI components
 * instead of storing URLs in the product object.
 */

// 2. Updated Home Response Shape
export interface HomeProductsResponse {
  featured: Product[];
  newArrivals: Product[];
  bestSellers: Product[];
}
