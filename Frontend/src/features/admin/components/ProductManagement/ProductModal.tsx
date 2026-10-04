import React, { useState, useEffect } from "react";
import { adminService } from "../../api/admin.service";
import { toast } from "sonner";
import {
  X,
  Upload,
  Loader2,
  Save,
  Tag,
  DollarSign,
  Info,
  Briefcase,
} from "lucide-react";
export const ProductModal = ({
  isOpen,
  onClose,
  onSuccess,
  initialData,
}: any) => {
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    brand: "",
    price: "",
    description: "",
    category: "",
  });
  useEffect(() => {
    if (initialData && isOpen) {
      setFormData({
        title: initialData.title || "",
        brand: initialData.brand || "",
        price: initialData.price?.toString() || "",
        description: initialData.description || "",
        category: initialData.category || initialData.categories?.[0] || "",
      });
      setPreview(initialData.image_url || null);
    } else {
      setFormData({
        title: "",
        brand: "",
        price: "",
        description: "",
        category: "",
      });
      setPreview(null);
    }
    setFile(null);
  }, [initialData, isOpen]);
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setPreview(URL.createObjectURL(selectedFile));
    }
  };
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const submissionData = {
        ...formData,
        price: parseFloat(formData.price) || 0,
      };
      let productId = initialData?.id;
      if (initialData) {
        await adminService.updateProduct(productId, submissionData);
      } else {
        const newProduct = await adminService.createProduct(submissionData);
        productId = newProduct.id;
      }
      if (file && productId) {
        const imageUrl = await adminService.uploadProductImage(file, productId);
        await adminService.updateProduct(productId, {
          image_url: imageUrl,
        });
      }
      toast.success(initialData ? "Product updated!" : "Product created!");
      onSuccess();
      onClose();
    } catch (err: any) {
      const errorMsg =
        err.response?.data?.details || err.message || "Failed to save product";
      toast.error(errorMsg);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl animate-in fade-in zoom-in duration-200 max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b flex justify-between items-center sticky top-0 bg-white z-10">
          <h3 className="text-xl font-bold text-gray-900">
            {initialData ? "Edit Product" : "Add New Product"}
          </h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full transition-all"
          >
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-1">
              <Tag size={16} /> Product Title
            </label>
            <input
              required
              placeholder="e.g. Classic T-Shirt"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              value={formData.title}
              onChange={(e) =>
                setFormData({ ...formData, title: e.target.value })
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-1">
                <Briefcase size={16} /> Brand
              </label>
              <input
                required
                placeholder="Brand Name"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                value={formData.brand}
                onChange={(e) =>
                  setFormData({ ...formData, brand: e.target.value })
                }
              />
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-1">
                <DollarSign size={16} /> Price
              </label>
              <input
                required
                type="number"
                step="0.01"
                placeholder="0.00"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                value={formData.price}
                onChange={(e) =>
                  setFormData({ ...formData, price: e.target.value })
                }
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-semibold text-gray-700 mb-1 block">
              Category
            </label>
            <input
              required
              placeholder="e.g. Electronics, Clothing"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              value={formData.category}
              onChange={(e) =>
                setFormData({ ...formData, category: e.target.value })
              }
            />
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-1">
              <Info size={16} /> Description
            </label>
            <textarea
              rows={3}
              placeholder="Tell us about the product..."
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all resize-none"
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Product Image
            </label>
            <div className="relative group h-40 w-full border-2 border-dashed border-gray-300 rounded-2xl flex flex-col items-center justify-center overflow-hidden hover:border-blue-400 transition-colors bg-gray-50">
              {preview ? (
                <img
                  src={preview}
                  alt="Preview"
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="text-center">
                  <Upload className="mx-auto text-gray-400 mb-2" size={32} />
                  <p className="text-xs text-gray-500">Click to upload image</p>
                </div>
              )}
              <input
                type="file"
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={handleFileChange}
                accept="image/*"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-blue-200 active:scale-[0.98] transition-all disabled:opacity-50 mt-2"
          >
            {loading ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Save size={20} />
            )}
            {initialData ? "Update Changes" : "Create Product"}
          </button>
        </form>
      </div>
    </div>
  );
};
