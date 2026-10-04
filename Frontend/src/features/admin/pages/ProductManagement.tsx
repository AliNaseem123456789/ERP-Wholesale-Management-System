import React, { useState, useEffect, useCallback, useRef } from "react";
import { adminService } from "../api/admin.service";
import { toast } from "sonner";
import { Package, Plus, Loader2, Search, X } from "lucide-react";
import { ProductTable } from "../components/ProductManagement/ProductTable";
import { ProductModal } from "../components/ProductManagement/ProductModal";
export const ProductManagement = () => {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const itemsPerPage = 10;
  const [cache, setCache] = useState<
    Record<string, { products: any[]; totalPages: number }>
  >({});
  const fetchProducts = useCallback(
    async (forceRefresh = false) => {
      const cacheKey = searchQuery
        ? `search-${searchQuery}-${currentPage}`
        : `page-${currentPage}`;
      if (!forceRefresh && cache[cacheKey]) {
        setProducts(cache[cacheKey].products);
        setTotalPages(cache[cacheKey].totalPages);
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const response = await adminService.getProducts(
          currentPage,
          itemsPerPage,
          searchQuery,
        );
        if (response && response.products) {
          const newData = {
            products: response.products,
            totalPages: response.totalPages,
          };
          setProducts(newData.products);
          setTotalPages(newData.totalPages);
          setCache((prev) => ({
            ...prev,
            [cacheKey]: newData,
          }));
        }
      } catch (err) {
        toast.error("Failed to load products");
      } finally {
        setLoading(false);
      }
    },
    [currentPage, searchQuery, cache],
  );
  const prefetchNextPage = useCallback(async () => {
    const nextPage = currentPage + 1;
    const nextCacheKey = searchQuery
      ? `search-${searchQuery}-${nextPage}`
      : `page-${nextPage}`;
    if (nextPage <= totalPages && !cache[nextCacheKey]) {
      try {
        const response = await adminService.getProducts(
          nextPage,
          itemsPerPage,
          searchQuery,
        );
        if (response && response.products) {
          setCache((prev) => ({
            ...prev,
            [nextCacheKey]: {
              products: response.products,
              totalPages: response.totalPages,
            },
          }));
        }
      } catch (err) {
        console.warn("Prefetch failed", err);
      }
    }
  }, [currentPage, totalPages, searchQuery, cache]);
  useEffect(() => {
    const delayDebounceFn = setTimeout(
      () => {
        fetchProducts();
      },
      searchQuery ? 400 : 0,
    );
    return () => clearTimeout(delayDebounceFn);
  }, [currentPage, searchQuery]);
  useEffect(() => {
    if (!loading) {
      const timer = setTimeout(() => prefetchNextPage(), 600);
      return () => clearTimeout(timer);
    }
  }, [loading, currentPage, searchQuery, prefetchNextPage]);
  const handleDataChange = () => {
    setCache({});
    if (currentPage === 1) fetchProducts(true);
    else setCurrentPage(1);
  };
  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setCurrentPage(1);
  };
  const clearSearch = () => {
    setSearchQuery("");
    setCurrentPage(1);
  };
  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this product?")) return;
    try {
      await adminService.deleteProduct(id);
      toast.success("Product deleted");
      handleDataChange();
    } catch (err) {
      toast.error("Delete failed");
    }
  };
  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Package className="text-blue-600" /> Product Inventory
          </h2>
          <p className="text-gray-500 text-sm">Managing catalog items</p>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              size={18}
            />
            <input
              type="text"
              placeholder="Search title or brand..."
              value={searchQuery}
              onChange={handleSearch}
              className="w-full pl-10 pr-10 py-2.5 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all shadow-sm"
            />
            {searchQuery && (
              <button
                onClick={clearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={16} />
              </button>
            )}
          </div>
          <button
            onClick={() => {
              setSelectedProduct(null);
              setIsModalOpen(true);
            }}
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl flex items-center gap-2 shadow-sm transition-all active:scale-95 whitespace-nowrap"
          >
            <Plus size={18} /> Add Product
          </button>
        </div>
      </div>

      {loading &&
      !cache[
        searchQuery
          ? `search-${searchQuery}-${currentPage}`
          : `page-${currentPage}`
      ] ? (
        <div className="flex flex-col items-center justify-center p-20 gap-4">
          <Loader2 className="animate-spin text-blue-500" size={40} />
          <p className="text-gray-400">Searching inventory...</p>
        </div>
      ) : products.length > 0 ? (
        <ProductTable
          products={products}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          onEdit={(p) => {
            setSelectedProduct(p);
            setIsModalOpen(true);
          }}
          onDelete={handleDelete}
        />
      ) : (
        <div className="bg-white rounded-2xl p-20 text-center border border-dashed border-gray-300">
          <p className="text-gray-500">
            No products found matching "{searchQuery}"
          </p>
          <button
            onClick={clearSearch}
            className="text-blue-600 mt-2 font-medium"
          >
            Clear search
          </button>
        </div>
      )}
      <ProductModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => {
          setIsModalOpen(false);
          handleDataChange();
        }}
        initialData={selectedProduct}
      />
    </div>
  );
};
