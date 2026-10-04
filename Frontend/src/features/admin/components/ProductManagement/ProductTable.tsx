import { Edit, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { getProductImage } from "../../../products/utils/getProductImage";

interface ProductTableProps {
  products: any[];
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onEdit: (product: any) => void;
  onDelete: (id: string) => void;
}
export const ProductTable = ({
  products,
  currentPage,
  totalPages,
  onPageChange,
  onEdit,
  onDelete,
}: ProductTableProps) => {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <table className="w-full text-left">
        <thead className="bg-gray-50/50 border-b border-gray-100">
          <tr>
            <th className="p-4 font-semibold text-gray-600 text-sm">Product</th>
            <th className="p-4 font-semibold text-gray-600 text-sm">Brand</th>
            <th className="p-4 font-semibold text-gray-600 text-sm">Price</th>
            <th className="p-4 font-semibold text-gray-600 text-sm text-right">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {products.map((p) => (
            <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
              <td className="p-4 flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-gray-100 overflow-hidden border border-gray-100 shrink-0">
                  <img
                    src={getProductImage(p.id)}
                    alt={p.title}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src =
                        "https://via.placeholder.com/150?text=No+Image";
                    }}
                  />
                </div>
                <span className="font-medium text-gray-900 truncate max-w-[200px]">
                  {p.title}
                </span>
              </td>
              <td className="p-4 text-gray-600">{p.brand}</td>
              <td className="p-4 font-bold text-gray-900">${p.price}</td>
              <td className="p-4 text-right">
                <div className="flex justify-end gap-1">
                  <button
                    onClick={() => onEdit(p)}
                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                  >
                    <Edit size={16} />
                  </button>
                  <button
                    onClick={() => onDelete(p.id)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="p-4 border-t bg-white flex items-center justify-between">
        <p className="text-sm text-gray-500 font-medium">
          Showing page <span className="text-gray-900">{currentPage}</span> of{" "}
          <span className="text-gray-900">{totalPages}</span>
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className="flex items-center gap-1 px-3 py-2 border rounded-xl hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-sm font-medium"
          >
            <ChevronLeft size={18} /> Prev
          </button>
          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="flex items-center gap-1 px-3 py-2 border rounded-xl hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-sm font-medium"
          >
            Next <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};
