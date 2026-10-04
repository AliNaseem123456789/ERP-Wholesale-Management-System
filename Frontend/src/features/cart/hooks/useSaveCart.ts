// src/features/cart/hooks/useSaveCart.ts
import { useState } from "react";
import { saveCartTemplate } from "../api/cartApi";
import { toast } from "sonner";

export function useSaveCart() {
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async (cartItems: any[], totalAmount: number) => {
    const name = prompt(
      "Enter a name for this saved cart (e.g., Monday Restock):"
    );
    if (!name) return;

    setIsSaving(true);
    try {
      const simplifiedItems = cartItems.map((item) => ({
        product_id: item.product_id,
        ...(item.flavor ? { flavor: item.flavor } : {}),
        quantity: item.quantity,
      }));

      await saveCartTemplate({
        cartName: name,
        items: simplifiedItems,
        totalAmount,
      });

      toast.success(`"${name}" has been saved successfully!`);
    } catch (err: any) {
      toast.error(err.message || "Failed to save template");
    } finally {
      setIsSaving(false);
    }
  };

  return { handleSave, isSaving };
}
