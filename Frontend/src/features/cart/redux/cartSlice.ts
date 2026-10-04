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
}

/* ---------- ASYNC THUNKS ---------- */

export const fetchCart = createAsyncThunk("cart/fetch", async () => {
  const response = await apiClient.get<CartItem[]>("/cart");
  return response.data;
});

// Adds `quantity` on top of whatever is already in the cart.
const serverMessage = (err: any) => new Error(err?.response?.data?.message || err?.message || "Request failed");

export const addItemToCart = createAsyncThunk(
  "cart/addItem",
  async ({ productId, quantity, flavor }: { productId: number; quantity: number; flavor?: string | null }) => {
    try {
      const response = await apiClient.post<CartItem>("/cart/add", { productId, quantity, flavor: flavor || undefined });
      return response.data;
    } catch (err) {
      throw serverMessage(err);
    }
  },
);

// Sets the quantity to an exact value.
export const updateCartQuantity = createAsyncThunk(
  "cart/updateQuantity",
  async ({ productId, quantity, flavor }: { productId: number; quantity: number; flavor?: string | null }) => {
    try {
      const response = await apiClient.patch<CartItem>(`/cart/${productId}`, { quantity, flavor: flavor || "" });
      return response.data;
    } catch (err) {
      throw serverMessage(err);
    }
  },
);

export const removeItemFromCart = createAsyncThunk(
  "cart/removeItem",
  async ({ productId, flavor }: { productId: number; flavor?: string | null }) => {
    await apiClient.delete(`/cart/${productId}?flavor=${encodeURIComponent(flavor || "")}`);
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
  } as CartState,
  reducers: {
    clearCart: (state) => {
      state.items = [];
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
        state.items = Array.isArray(action.payload) ? action.payload : [];
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

export const { clearCart } = cartSlice.actions;
export default cartSlice.reducer;
