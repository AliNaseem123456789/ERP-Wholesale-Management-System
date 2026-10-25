import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { apiClient } from "../../../api/apiClient";

export interface CartItem {
  id?: number;
  product_id: number;
  quantity: number;
  flavor?: string | null;
  products: {
    id: number;
    title: string;
    brand: string;
    description: string;
    url?: string;
    price?: number;
    flavors?: string[];
    categories?: string[];
    company?: { id: number; name: string; slug: string } | null;
    stock_status?: "in_stock" | "out_of_stock" | null;
    available?: number;
    flavor_stock?: Record<string, number>;
    list_price?: number;
    price_tiers?: { min_quantity: number; price: number }[];
  } | null;
}

interface CartState {
  items: CartItem[];
  loading: boolean;
  error: string | null;
  /** the cart being shopped into; null = the user's main (default) cart */
  cartId: string | null;
}

const ACTIVE_KEY = "activeCart";
const readActive = (): string | null => {
  try {
    return localStorage.getItem(ACTIVE_KEY) || null;
  } catch {
    return null;
  }
};
const writeActive = (id: string | null) => {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* storage unavailable */
  }
};
const cartParam = (getState: () => unknown) => (getState() as { cart: CartState }).cart.cartId;

/* ---------- ASYNC THUNKS ---------- */

// Loads the active cart (or the cart given). A cart that no longer exists falls back to the main cart.
export const fetchCart = createAsyncThunk("cart/fetch", async (cartId: string | null | undefined, { getState }) => {
  const id = cartId === undefined ? cartParam(getState) : cartId;
  try {
    const response = await apiClient.get<CartItem[]>(`/cart${id ? `?cart=${id}` : ""}`);
    return { items: response.data, cartId: id || null };
  } catch (err: any) {
    if (id && err?.response?.status === 404) {
      const response = await apiClient.get<CartItem[]>("/cart");
      return { items: response.data, cartId: null };
    }
    throw err;
  }
});

// Adds `quantity` on top of whatever is already in the cart.
const serverMessage = (err: any) => new Error(err?.response?.data?.message || err?.message || "Request failed");

export const addItemToCart = createAsyncThunk(
  "cart/addItem",
  async ({ productId, quantity, flavor }: { productId: number; quantity: number; flavor?: string | null }, { getState }) => {
    try {
      const response = await apiClient.post<CartItem>("/cart/add", { productId, quantity, flavor: flavor || undefined, cart_id: cartParam(getState) || undefined });
      return response.data;
    } catch (err) {
      throw serverMessage(err);
    }
  },
);

// Sets the quantity to an exact value.
export const updateCartQuantity = createAsyncThunk(
  "cart/updateQuantity",
  async ({ productId, quantity, flavor }: { productId: number; quantity: number; flavor?: string | null }, { getState }) => {
    try {
      const response = await apiClient.patch<CartItem>(`/cart/${productId}`, { quantity, flavor: flavor || "", cart_id: cartParam(getState) || undefined });
      return response.data;
    } catch (err) {
      throw serverMessage(err);
    }
  },
);

export const removeItemFromCart = createAsyncThunk(
  "cart/removeItem",
  async ({ productId, flavor }: { productId: number; flavor?: string | null }, { getState }) => {
    const c = cartParam(getState);
    await apiClient.delete(`/cart/${productId}?flavor=${encodeURIComponent(flavor || "")}${c ? `&cart=${c}` : ""}`);
    return { productId, flavor: flavor || "" };
  },
);

const upsertItem = (state: CartState, item: CartItem) => {
  if (!item) return;
  const index = state.items.findIndex(
    (i) => Number(i.product_id) === Number(item.product_id) && (i.flavor || "") === (item.flavor || ""),
  );
  if (index !== -1) {
    state.items[index] = { ...state.items[index], ...item };
  } else {
    state.items.push(item);
  }
};

const cartSlice = createSlice({
  name: "cart",
  initialState: {
    items: [],
    loading: false,
    error: null,
    cartId: readActive(),
  } as CartState,
  reducers: {
    clearCart: (state) => {
      state.items = [];
    },
    // switch which cart is shopped into (null = main cart); load it with fetchCart afterwards
    setActiveCart: (state, action: { payload: string | null }) => {
      state.cartId = action.payload ? String(action.payload) : null;
      writeActive(state.cartId);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchCart.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchCart.fulfilled, (state, action) => {
        state.loading = false;
        state.items = Array.isArray(action.payload.items) ? action.payload.items : [];
        state.cartId = action.payload.cartId ? String(action.payload.cartId) : null;
        writeActive(state.cartId);
      })
      .addCase(fetchCart.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || "Failed to load cart";
      })
      .addCase(addItemToCart.fulfilled, (state, action) => {
        upsertItem(state, action.payload);
      })
      .addCase(updateCartQuantity.fulfilled, (state, action) => {
        upsertItem(state, action.payload);
      })
      .addCase(removeItemFromCart.fulfilled, (state, action) => {
        state.items = state.items.filter(
          (item) => !(Number(item.product_id) === Number(action.payload.productId) && (item.flavor || "") === action.payload.flavor),
        );
      });
  },
});

export const { clearCart, setActiveCart } = cartSlice.actions;
export default cartSlice.reducer;
