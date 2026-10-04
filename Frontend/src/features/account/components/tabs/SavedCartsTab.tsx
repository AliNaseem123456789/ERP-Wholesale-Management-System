import React, { useState, useEffect } from "react";
import { useSavedCarts } from "../../../cart/hooks/useSavedCarts";
import {
  getSavedCartById,
  restoreSavedCart,
  deleteSavedCart,
} from "../../../cart/api/cartApi";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import { AppDispatch } from "../../../../app/store";
import { fetchCart } from "../../../cart/redux/cartSlice";
import {
  Loader2,
  Package,
  Eye,
  Printer,
  ArrowLeft,
  ShoppingCart,
  Trash2,
  Tag,
  Hash,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";

export const SavedCartsTab: React.FC = () => {
  const { templates, loading: listLoading, refetch } = useSavedCarts();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const [restoring, setRestoring] = useState(false);

  const handleRestore = async (id: number) => {
    setRestoring(true);
    try {
      await restoreSavedCart(id);
      await dispatch(fetchCart());
      toast.success("Items added to your cart");
      navigate("/cart");
    } catch (err: any) {
      toast.error(err.message || "Failed to restore cart");
    } finally {
      setRestoring(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Delete this saved cart?")) return;
    try {
      await deleteSavedCart(id);
      toast.success("Saved cart deleted");
      refetch();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete saved cart");
    }
  };
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailData, setDetailData] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  
  useEffect(() => {
    if (selectedId) {
      const fetchDetails = async () => {
        setDetailLoading(true);
        try {
          const data = await getSavedCartById(selectedId);
          // Parse items if it's a string
          if (data && typeof data.items === 'string') {
            data.items = JSON.parse(data.items);
          }
          setDetailData(data);
        } catch (err) {
          toast.error("Failed to load cart details");
          setSelectedId(null);
        } finally {
          setDetailLoading(false);
        }
      };
      fetchDetails();
    }
  }, [selectedId]);

  // Helper function to parse items
  const parseItems = (items: any): any[] => {
    if (Array.isArray(items)) return items;
    if (typeof items === 'string') {
      try {
        return JSON.parse(items);
      } catch {
        return [];
      }
    }
    return [];
  };

  if (listLoading)
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    );
    
  if (selectedId && detailData) {
    // Parse items for detail view
    const detailItems = parseItems(detailData.items);
    
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
        <button
          onClick={() => {
            setSelectedId(null);
            setDetailData(null);
          }}
          className="flex items-center gap-2 text-blue-600 font-medium hover:underline mb-4"
        >
          <ArrowLeft size={18} /> Back to Saved Carts
        </button>

        <div className="bg-white border rounded-2xl p-6 shadow-sm flex flex-col md:flex-row justify-between gap-6">
          <div>
            <h2 className="text-2xl font-black text-gray-900">
              {detailData.cart_name}
            </h2>
            <div className="flex flex-wrap gap-4 mt-3 text-sm text-gray-500">
              <span className="flex items-center gap-1">
                <Hash size={14} /> ID: {detailData.id}
              </span>
              <span className="flex items-center gap-1">
                <Calendar size={14} /> Saved on{" "}
                {new Date(detailData.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 px-4 py-2 border rounded-xl hover:bg-gray-50 font-bold text-sm transition-colors"
            >
              <Printer size={18} /> Print Template
            </button>
            <button
              onClick={() => handleRestore(detailData.id)}
              disabled={restoring}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 disabled:bg-blue-300 transition-colors"
            >
              {restoring ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <ShoppingCart size={18} />
              )}{" "}
              Restore to Active Cart
            </button>
          </div>
        </div>

        <div className="bg-white border rounded-2xl overflow-hidden shadow-sm">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="px-6 py-4 text-xs font-bold uppercase text-gray-500">
                  Product
                </th>
                <th className="px-6 py-4 text-xs font-bold uppercase text-gray-500 text-center">
                  Quantity
                </th>
                <th className="px-6 py-4 text-xs font-bold uppercase text-gray-500 text-right">
                  Unit Price
                </th>
                <th className="px-6 py-4 text-xs font-bold uppercase text-gray-500 text-right">
                  Subtotal
                </th>
              </tr>
            </thead>
            <tbody className="divide-y text-sm">
              {detailItems.map((item: any, index: number) => (
                <tr
                  key={index}
                  className="hover:bg-gray-50 transition-colors"
                >
                  <td className="px-6 py-4">
                    <div>
                      <p className="font-bold text-gray-900">{item.title || `Product ID: ${item.product_id}`}{item.flavor ? <span className="font-medium text-blue-700"> · {item.flavor}</span> : null}</p>
                      <p className="text-xs text-blue-600 uppercase font-medium">
                        {item.brand || ''}
                      </p>
                    </div>
                   </td>
                  <td className="px-6 py-4 text-center font-bold">
                    {item.quantity}
                   </td>
                  <td className="px-6 py-4 text-right text-gray-500">
                    ${Number(item.price || 0).toFixed(2)}
                   </td>
                  <td className="px-6 py-4 text-right font-bold text-gray-900">
                    ${(Number(item.price || 0) * item.quantity).toFixed(2)}
                   </td>
                 </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-blue-50/50">
                <td
                  colSpan={3}
                  className="px-6 py-4 text-right font-bold text-gray-900"
                >
                  Total Estimated Amount
                 </td>
                <td className="px-6 py-4 text-right text-xl font-black text-blue-600">
                  ${Number(detailData.total_amount || 0).toFixed(2)}
                 </td>
               </tr>
            </tfoot>
           </table>
        </div>
      </div>
    );
  }

  if (detailLoading)
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="animate-spin text-blue-600 mb-2" />
        <p className="text-sm text-gray-500">Loading details...</p>
      </div>
    );

  // --- LIST VIEW (Your Table) ---
  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="px-6 py-4 text-xs font-bold uppercase text-gray-500">
                Cart ID#
              </th>
              <th className="px-6 py-4 text-xs font-bold uppercase text-gray-500">
                Cart Name
              </th>
              <th className="px-6 py-4 text-xs font-bold uppercase text-gray-500">
                Cart Items
              </th>
              <th className="px-6 py-4 text-xs font-bold uppercase text-gray-500">
                Created On
              </th>
              <th className="px-6 py-4 text-xs font-bold uppercase text-gray-500 text-right">
                Actions
              </th>
             </tr>
          </thead>
          <tbody className="divide-y">
            {templates.map((template) => {
              // Parse items - handle both string and array
              const itemsArray = parseItems(template.items);
              const totalUnits = itemsArray.reduce(
                (acc: number, item: any) => acc + (item.quantity || 0),
                0,
              );
              return (
                <tr
                  key={template.id}
                  className="hover:bg-gray-50 transition-colors"
                >
                  <td className="px-6 py-4 font-mono text-sm text-gray-600">
                    #{template.id.toString().padStart(4, "0")}
                   </td>
                  <td className="px-6 py-4 font-bold text-gray-900">
                    {template.cart_name}
                   </td>
                  <td className="px-6 py-4">
                    <div className="text-sm">
                      <p className="text-gray-900 font-medium">
                        {totalUnits} Units
                      </p>
                      <p className="text-gray-500 text-xs">
                        {itemsArray.length} Products
                      </p>
                    </div>
                   </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {new Date(template.created_at).toLocaleDateString()}
                   </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setSelectedId(template.id)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg flex items-center gap-1 text-sm font-bold transition-colors"
                      >
                        <Eye size={18} /> View
                      </button>
                      <button
                        onClick={() => handleRestore(template.id)}
                        disabled={restoring}
                        className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1 text-sm font-bold"
                      >
                        <ShoppingCart size={18} /> Restore
                      </button>
                      <button
                        onClick={() => handleDelete(template.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-1 text-sm font-bold"
                      >
                        <Trash2 size={18} /> Delete
                      </button>
                    </div>
                   </td>
                 </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};