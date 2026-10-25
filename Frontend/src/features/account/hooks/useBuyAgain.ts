import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AppDispatch, RootState } from "../../../app/store";
import { fetchCart } from "../../cart/redux/cartSlice";
import { buyingApi, buyingError } from "../api/buying.api";

/** "Buy again": adds what can still be bought from a past order to the active cart. */
export const useBuyAgain = () => {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const cartId = useSelector((s: RootState) => s.cart.cartId);
  const [busy, setBusy] = useState<string | number | null>(null);
  const buyAgain = async (orderId: number | string) => {
    setBusy(orderId);
    try {
      const r = await buyingApi.reorder(orderId, cartId);
      if (!r.added.length) return toast.error(r.message);
      dispatch(fetchCart(undefined));
      toast.success(r.message, {
        description: r.skipped.length ? r.skipped.slice(0, 4).map((s) => `${s.title}: ${s.reason}`).join("\n") : undefined,
        action: { label: "View cart", onClick: () => navigate("/cart") },
      });
    } catch (e) {
      toast.error(buyingError(e));
    } finally {
      setBusy(null);
    }
  };
  return { buyAgain, busy };
};
