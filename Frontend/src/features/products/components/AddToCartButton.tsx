// src/features/cart/components/AddToCartButton.tsx
import React, { useState } from "react";
import { useDispatch } from "react-redux";
import { AppDispatch } from "../../../app/store";
import { addItemToCart } from "../../cart/redux/cartSlice";
import { Loader2, ShoppingCart } from "lucide-react";
import { toast } from "sonner";

interface AddToCartButtonProps {
  productId: number;
  quantity: number;
  flavor?: string;
  className?: string;
}

export const AddToCartButton: React.FC<AddToCartButtonProps> = ({
  productId,
  quantity,
  flavor,
  className = "",
}) => {
  const dispatch = useDispatch<AppDispatch>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAdd = async () => {
    try {
      setIsSubmitting(true);
      // Dispatching the Redux thunk
      await dispatch(addItemToCart({ productId, quantity, flavor })).unwrap();
      toast.success(flavor ? `Added ${flavor} to cart` : "Added to cart");
    } catch (error: any) {
      toast.error(error?.message || "Could not add to cart. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <button
      onClick={handleAdd}
      disabled={isSubmitting}
      className={`flex items-center justify-center gap-2 w-full h-12 bg-brand text-white rounded-lg text-[15px] font-semibold hover:bg-brand-hover disabled:opacity-70 ${className}`}
    >
      {isSubmitting ? (
        <Loader2 className="animate-spin" size={20} />
      ) : (
        <ShoppingCart size={20} />
      )}
      {isSubmitting ? "Adding…" : "Add to cart"}
    </button>
  );
};
