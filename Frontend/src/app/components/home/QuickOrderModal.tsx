import React, { useState } from "react";
import { createPortal } from "react-dom";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { X, Minus, Plus, Trash2, ShoppingCart } from "lucide-react";
import { AppDispatch } from "../../store";
import { addItemToCart } from "../../../features/cart/redux/cartSlice";
import { useAuth } from "../../../features/auth/context/AuthContext";

interface QuickOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: {
    title: string;
    brand: string;
    imageUrl: string;
    variants: string[];
    id?: number;
    /** false = the product has no flavours (variants is just ["Standard"]) */
    hasFlavors?: boolean;
    flavorStock?: Record<string, number>;
  };
}

const QuickOrderModal: React.FC<QuickOrderModalProps> = ({
  isOpen,
  onClose,
  product,
}) => {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [adding, setAdding] = useState(false);
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const { user } = useAuth();

  if (!isOpen) return null;

  const total = Object.values(quantities).reduce((s, q) => s + q, 0);
  // Adds every flavour with a quantity as its own cart line.
  const addAll = async () => {
    if (!user) return navigate("/login");
    if (!product.id || !total) return;
    setAdding(true);
    let ok = 0;
    for (const [variant, qty] of Object.entries(quantities)) {
      if (!qty) continue;
      try {
        await dispatch(addItemToCart({ productId: product.id, quantity: qty, flavor: product.hasFlavors === false ? undefined : variant })).unwrap();
        ok += qty;
      } catch (err: any) {
        toast.error(`${variant}: ${err?.message || "could not be added"}`);
      }
    }
    setAdding(false);
    if (ok) {
      toast.success(`${ok} item${ok > 1 ? "s" : ""} added to cart`);
      setQuantities({});
      onClose();
    }
  };

  const updateQty = (variant: string, delta: number) => {
    setQuantities((prev) => ({
      ...prev,
      [variant]: Math.max(0, (prev[variant] || 0) + delta),
    }));
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
      <div className="w-full max-w-2xl bg-white dark:bg-[#1a1a24] rounded-xl shadow-2xl overflow-hidden">
        <div className="bg-[#003366] text-white px-6 py-4 flex justify-between">
          <h2 className="font-black uppercase">Wholesale Quick Order</h2>
          <button onClick={onClose}>
            <X />
          </button>
        </div>

        <div className="p-6">
          <div className="flex gap-4 mb-6">
            <img src={product.imageUrl} className="w-20 h-20 object-contain" />
            <div>
              <p className="text-xs font-bold text-cyan-500 uppercase">
                {product.brand}
              </p>
              <h3 className="font-black uppercase">{product.title}</h3>
            </div>
          </div>

          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {product.variants.map((v) => (
              <div
                key={v}
                className="flex justify-between items-center p-3 bg-gray-50 rounded"
              >
                <span className="font-bold text-sm text-gray-900">
                  {v}
                  {product.flavorStock?.[v] !== undefined && <span className="ml-2 text-xs font-medium text-gray-500">{product.flavorStock[v]} available</span>}
                </span>
                <div className="flex items-center gap-2">
                  <button onClick={() => updateQty(v, -1)} aria-label={`Fewer ${v}`}>
                    <Minus size={14} />
                  </button>
                  <span className="w-6 text-center">{quantities[v] || 0}</span>
                  <button onClick={() => updateQty(v, 1)} aria-label={`More ${v}`}>
                    <Plus size={14} />
                  </button>
                  <button
                    onClick={() => setQuantities((p) => ({ ...p, [v]: 0 }))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {product.id && (
            <div className="mt-6 flex items-center justify-between gap-3">
              <span className="text-sm text-gray-500">{total} selected</span>
              <button
                onClick={addAll}
                disabled={adding || (!!user && !total)}
                className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-bold px-5 py-2.5 rounded-lg"
              >
                <ShoppingCart size={16} /> {user ? (adding ? "Adding..." : "Add to cart") : "Log in to order"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default QuickOrderModal;
