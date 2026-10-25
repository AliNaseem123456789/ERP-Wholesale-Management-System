// src/features/cart/api/cartApi.ts
import { apiClient } from "../../../api/apiClient";

const errMsg = (err: any, fallback: string) =>
  new Error(err?.response?.data?.message || fallback);

export async function saveCartTemplate(payload: {
  cartName: string;
  items: { product_id: number; flavor?: string; quantity: number }[];
  totalAmount: number;
}) {
  try {
    const { data } = await apiClient.post("/cart/save-cart-template", payload);
    return data;
  } catch (err) {
    throw errMsg(err, "Failed to save cart template");
  }
}

export async function getSavedCarts() {
  try {
    const { data } = await apiClient.get("/cart/saved-cart-templates");
    return data.data || [];
  } catch (err) {
    throw errMsg(err, "Failed to fetch saved templates");
  }
}

export async function getSavedCartById(id: string | number) {
  try {
    const { data } = await apiClient.get(`/cart/saved-cart-templates-details/${id}`);
    return data.data;
  } catch (err) {
    throw errMsg(err, "Failed to fetch template details");
  }
}

export async function deleteSavedCart(id: string | number) {
  try {
    const { data } = await apiClient.delete(`/cart/saved-cart-templates/${id}`);
    return data;
  } catch (err) {
    throw errMsg(err, "Failed to delete template");
  }
}

// Copies a saved template's items into the active cart.
export async function restoreSavedCart(id: string | number, cartId?: string | null) {
  try {
    const { data } = await apiClient.post(`/cart/saved-cart-templates/${id}/restore`, { cart_id: cartId || undefined });
    return data;
  } catch (err) {
    throw errMsg(err, "Failed to restore template");
  }
}

/** Share a saved cart with your team (account owner and sub-accounts), or stop sharing it. */
export async function shareSavedCart(id: string | number, shared: boolean) {
  const { data } = await apiClient.patch(`/cart/saved-cart-templates/${id}`, { shared_with_team: shared });
  return data;
}
