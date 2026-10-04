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
  stock_status?: "in_stock" | "out_of_stock" | null;
  /** only sent to logged-in customers */
  available?: number;
  /** available per flavour (logged-in customers, sellers that track stock) */
  flavor_stock?: Record<string, number>;
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
