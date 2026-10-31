import React, { useState, useEffect } from "react";
import { adminService, type ProductImage } from "../../api/admin.service";
import { toast } from "sonner";
import {
  X,
  Loader2,
  Save,
  Tag,
  DollarSign,
  Info,
  Briefcase,
  Star,
  Trash2,
  ImagePlus,
} from "lucide-react";

const MAX_IMAGES = 12;
export const ProductModal = ({
  isOpen,
  onClose,
  onSuccess,
  initialData,
}: any) => {
  const [loading, setLoading] = useState(false);
  // Gallery: saved images (first = main image) and new files that are uploaded on save.
  const [images, setImages] = useState<ProductImage[]>([]);
  const [newFiles, setNewFiles] = useState<{ file: File; preview: string }[]>([]);
  const [imagesBusy, setImagesBusy] = useState(false);
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
    } else {
      setFormData({
        title: "",
        brand: "",
        price: "",
        description: "",
        category: "",
      });
    }
    setImages([]);
    setNewFiles([]);
    if (initialData?.id && isOpen) {
      adminService
        .listProductImages(initialData.id)
        .then(setImages)
        .catch(() => toast.error("Couldn't load the product's images"));
    }
  }, [initialData, isOpen]);
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    const room = MAX_IMAGES - images.length - newFiles.length;
    if (picked.length > room) toast.error(`A product can have at most ${MAX_IMAGES} images`);
    setNewFiles((prev) => [
      ...prev,
      ...picked.slice(0, Math.max(0, room)).map((file) => ({ file, preview: URL.createObjectURL(file) })),
    ]);
  };
  const removeNewFile = (index: number) =>
    setNewFiles((prev) => prev.filter((_, i) => i !== index));
  // Saved images change right away (delete / make main); new files wait for the save button.
  const makeMain = async (imageId: ProductImage["id"]) => {
    setImagesBusy(true);
    try {
      const ids = [imageId, ...images.map((i) => i.id).filter((id) => String(id) !== String(imageId))];
      setImages(await adminService.reorderProductImages(initialData.id, ids));
      toast.success("Main image changed");
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Couldn't change the main image");
    } finally {
      setImagesBusy(false);
    }
  };
  const deleteImage = async (imageId: ProductImage["id"]) => {
    if (!window.confirm("Delete this image?")) return;
    setImagesBusy(true);
    try {
      setImages(await adminService.deleteProductImage(initialData.id, imageId));
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Couldn't delete the image");
    } finally {
      setImagesBusy(false);
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
      if (newFiles.length && productId) {
        await adminService.addProductImages(
          productId,
          newFiles.map((f) => f.file),
        );
      }
      toast.success(initialData ? "Product updated!" : "Product created!");
      onSuccess();
      onClose();
    } catch (err: any) {
      const errorMsg =
        err.response?.data?.details ||
        err.response?.data?.message ||
        err.message ||
        "Failed to save product";
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
            <label className="flex items-center justify-between text-sm font-semibold text-gray-700 mb-1">
              <span>Product Images</span>
              <span className="text-xs font-normal text-gray-500">
                {images.length + newFiles.length}/{MAX_IMAGES} · the first one is the main image
              </span>
            </label>
            <div className="grid grid-cols-4 gap-2">
              {images.map((img, i) => (
                <div
                  key={img.id}
                  className={`relative group aspect-square rounded-xl overflow-hidden border-2 bg-gray-50 ${
                    i === 0 ? "border-blue-500" : "border-gray-200"
                  }`}
                >
                  <img src={img.url} alt={img.alt_text || ""} className="w-full h-full object-contain" />
                  {i === 0 && (
                    <span className="absolute top-1 left-1 bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                      MAIN
                    </span>
                  )}
                  <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 p-1 bg-black/50 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    {i > 0 && (
                      <button
                        type="button"
                        disabled={imagesBusy}
                        title="Make main image"
                        onClick={() => makeMain(img.id)}
                        className="p-1 rounded bg-white/90 hover:bg-white text-gray-800 disabled:opacity-50"
                      >
                        <Star size={14} />
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={imagesBusy}
                      title="Delete image"
                      onClick={() => deleteImage(img.id)}
                      className="p-1 rounded bg-white/90 hover:bg-white text-red-600 disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
              {newFiles.map((f, i) => (
                <div
                  key={f.preview}
                  className={`relative aspect-square rounded-xl overflow-hidden border-2 border-dashed bg-gray-50 ${
                    !images.length && i === 0 ? "border-blue-500" : "border-green-400"
                  }`}
                >
                  <img src={f.preview} alt="" className="w-full h-full object-contain" />
                  <span className="absolute top-1 left-1 bg-green-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                    {!images.length && i === 0 ? "NEW · MAIN" : "NEW"}
                  </span>
                  <button
                    type="button"
                    title="Remove"
                    onClick={() => removeNewFile(i)}
                    className="absolute top-1 right-1 p-0.5 rounded-full bg-white/90 hover:bg-white text-gray-700"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              {images.length + newFiles.length < MAX_IMAGES && (
                <label className="relative aspect-square border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center hover:border-blue-400 transition-colors bg-gray-50 cursor-pointer">
                  {imagesBusy ? (
                    <Loader2 className="animate-spin text-gray-400" size={24} />
                  ) : (
                    <>
                      <ImagePlus className="text-gray-400 mb-1" size={24} />
                      <span className="text-[11px] text-gray-500">Add images</span>
                    </>
                  )}
                  <input
                    type="file"
                    multiple
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={handleFileChange}
                    accept="image/jpeg,image/png,image/webp,image/gif"
                  />
                </label>
              )}
            </div>
            {newFiles.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                {newFiles.length} new image{newFiles.length === 1 ? "" : "s"} will be uploaded when you save.
              </p>
            )}
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
