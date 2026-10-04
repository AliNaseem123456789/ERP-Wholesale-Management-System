import { useDispatch, useSelector } from "react-redux";
import { AppDispatch, RootState } from "../../../app/store";
import { toast } from "sonner";
import { updateCartQuantity, removeItemFromCart } from "../redux/cartSlice";

export const useCartActions = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { items } = useSelector((state: RootState) => state.cart);

  const calculateTotal = () =>
    items.reduce(
      (total, item) => total + Number(item.products?.price || 0) * item.quantity,
      0
    );

  const handleUpdateQuantity = async (productId: number, newQty: number, flavor?: string | null) => {
    if (newQty < 1) return;
    try {
      await dispatch(updateCartQuantity({ productId, quantity: newQty, flavor })).unwrap();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update quantity");
    }
  };

  const handleRemove = async (productId: number, flavor?: string | null) => {
    try {
      await dispatch(removeItemFromCart({ productId, flavor })).unwrap();
      toast.success("Item removed");
    } catch (err) {
      toast.error("Failed to remove item");
    }
  };

  return {
    items,
    calculateTotal,
    handleUpdateQuantity,
    handleRemove,
  };
};
