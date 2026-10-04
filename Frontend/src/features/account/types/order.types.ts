export interface OrderItem {
  id?: number;
  products: { title: string; url?: string | null } | null;
  flavor?: string | null;
  quantity: number;
  price_at_time: number;
}

export interface ShippingAddress {
  full_name: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  postal_code: string;
  phone?: string;
}

// Shape returned by GET /api/orders/my-orders
export interface Order {
  id: number;
  order_number?: string | null;
  tracking_number?: string | null;
  shipping_amount?: number | null;
  company?: { id: number; name: string; slug: string } | null;
  status: string;
  total_amount: number;
  business_name: string | null;
  created_at: string;
  shipping_address: ShippingAddress | null;
  billing_address: ShippingAddress | null;
  order_items: OrderItem[];
  subtotal_amount?: number | null;
  discount_amount?: number | null;
  tax_amount?: number | null;
  excise_amount?: number | string | null;
  payment_method?: string | null;
  promo_code?: string | null;
  invoices?: { id: number; invoice_number: string; status: string }[];
}
