import { COMPLIANCE_CATEGORIES } from "../api/ops.api";
import React, { useCallback, useEffect, useState } from "react";
import { Package, Plus, Search, Pencil, Trash2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { businessApi, errorMessage } from "../api/business.api";
import { getProductImage } from "../../products/utils/getProductImage";
import { supplyApi, Supplier } from "../api/supply.api";
import {
  Card, PageHeader, Spinner, EmptyState, StatusBadge, Pagination, Modal, Field,
  money, inputCls, btnPrimary, btnSecondary, inputBase
} from "../components/ui";

type Product = {
  id: number; title: string; brand: string; sku?: string | null; price?: number | null; description?: string | null;
  categories?: string[]; flavors?: string[]; is_active: boolean;
  barcode?: string | null; unit?: string; cost_price?: number; reorder_point?: number; reorder_quantity?: number;
  preferred_supplier_id?: number | null;
};

/** Per-flavour stock, SKU and barcode (each flavour can have its own barcode for scanning). */
const FlavorCodes: React.FC<{ productId: number }> = ({ productId }) => {
  const { companyId, can } = useBusiness();
  const [rows, setRows] = useState<any[] | null>(null);
  const [unassigned, setUnassigned] = useState(0);
  useEffect(() => {
    supplyApi.variants(companyId!, productId).then((d) => { setRows(d.data); setUnassigned(d.unassigned); }).catch(() => setRows([]));
  }, [companyId, productId]);
  if (!rows || !rows.length) return null;
  const save = async () => {
    try {
      toast.success((await supplyApi.saveVariants(companyId!, productId, rows.map((r) => ({ flavor: r.flavor, sku: r.sku || "", barcode: r.barcode || "" })))).message);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const canEdit = can("products.manage") || can("inventory.manage");
  return (
    <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4 space-y-2">
      <p className="text-xs font-bold uppercase text-gray-500 tracking-wide">Flavours: stock, SKU &amp; barcode</p>
      <div className="grid grid-cols-[1fr_90px_1fr_1fr] gap-2 text-[10px] font-bold uppercase text-gray-400"><span>Flavour</span><span className="text-right">On hand</span><span>SKU</span><span>Barcode</span></div>
      {rows.map((r, i) => (
        <div key={r.flavor} className="grid grid-cols-[1fr_90px_1fr_1fr] gap-2 items-center text-sm">
          <span className="font-semibold">{r.flavor}</span>
          <span className="text-right">{r.on_hand}{r.reserved ? <span className="text-gray-400"> ({r.reserved} reserved)</span> : null}</span>
          <input disabled={!canEdit} className={inputCls} value={r.sku || ""} onChange={(e) => setRows((prev) => prev!.map((x, j) => (j === i ? { ...x, sku: e.target.value } : x)))} aria-label={`${r.flavor} SKU`} />
          <input disabled={!canEdit} className={inputCls} value={r.barcode || ""} onChange={(e) => setRows((prev) => prev!.map((x, j) => (j === i ? { ...x, barcode: e.target.value } : x)))} aria-label={`${r.flavor} barcode`} />
        </div>
      ))}
      {unassigned > 0 && <p className="text-xs text-amber-800">{unassigned} unit(s) aren't assigned to a flavour yet. Assign them under Inventory → Stock.</p>}
      {canEdit && <div className="flex justify-end"><button type="button" onClick={save} className={btnSecondary}>Save flavour codes</button></div>}
    </div>
  );
};

const ProductForm: React.FC<{ product: Product | null; onClose: () => void; onSaved: () => void }> = ({ product, onClose, onSaved }) => {
  const { companyId } = useBusiness();
  const [brands, setBrands] = useState<{ id: number; name: string }[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: product?.title || "",
    brand: product?.brand || "",
    sku: product?.sku || "",
    price: product?.price != null ? String(product.price) : "",
    categories: (product?.categories || []).join(", "),
    flavors: (product?.flavors || []).join(", "),
    description: product?.description || "",
    is_active: product?.is_active ?? true,
    barcode: product?.barcode || "",
    unit: product?.unit || "each",
    cost_price: product?.cost_price != null ? String(product.cost_price) : "",
    reorder_point: String(product?.reorder_point ?? ""),
    reorder_quantity: String(product?.reorder_quantity ?? ""),
    preferred_supplier_id: product?.preferred_supplier_id ? String(product.preferred_supplier_id) : "",
    compliance_category: (product as any)?.compliance_category || "none",
    nicotine_ml: (product as any)?.nicotine_ml != null ? String((product as any).nicotine_ml) : "",
    is_flavored: !!(product as any)?.is_flavored,
  });
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const { can } = useBusiness();
  useEffect(() => {
    if (can("purchasing.view")) supplyApi.suppliers(companyId!, { active: true }).then(setSuppliers).catch(() => {});
  }, [companyId]);

  useEffect(() => {
    businessApi.brands(companyId!).then(setBrands).catch(() => {});
  }, [companyId]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value } as typeof form);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, unknown> = { ...form, price: form.price === "" ? null : Number(form.price) };
      if (form.cost_price === "") delete body.cost_price;
      if (!can("purchasing.view")) delete body.preferred_supplier_id;
      const saved = product
        ? await businessApi.updateProduct(companyId!, product.id, body)
        : await businessApi.createProduct(companyId!, body);
      if (file) {
        try {
          await businessApi.uploadProductImage(companyId!, saved.id, file);
        } catch (err) {
          toast.error(`Product saved, but the image upload failed: ${errorMessage(err)}`);
        }
      }
      toast.success(product ? "Product updated" : "Product created");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={product ? "Edit product" : "New product"} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Title *"><input required className={inputCls} value={form.title} onChange={set("title")} /></Field>
          <Field label="Brand *" hint="Pick one of your brands or type a new one">
            <input required list="company-brands" className={inputCls} value={form.brand} onChange={set("brand")} />
            <datalist id="company-brands">{brands.map((b) => <option key={b.id} value={b.name} />)}</datalist>
          </Field>
          <Field label="Wholesale price (USD)" hint="Leave empty to hide from checkout">
            <input type="number" min="0" step="0.01" className={inputCls} value={form.price} onChange={set("price")} />
          </Field>
          <Field label="SKU"><input className={inputCls} value={form.sku} onChange={set("sku")} /></Field>
          <Field label="Categories" hint="Comma separated, e.g. Disposable Vapes, Pods">
            <input className={inputCls} value={form.categories} onChange={set("categories")} />
          </Field>
          <Field label="Flavours" hint="Comma separated. Stock and orders are kept per flavour.">
            <input className={inputCls} value={form.flavors} onChange={set("flavors")} />
          </Field>
        </div>
        <Field label="Description"><textarea rows={3} className={inputCls} value={form.description} onChange={set("description")} /></Field>
        <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
          <p className="col-span-2 md:col-span-3 text-xs font-bold uppercase text-gray-500 tracking-wide">Inventory &amp; purchasing</p>
          <Field label="Barcode"><input className={inputCls} value={form.barcode} onChange={set("barcode")} placeholder="Scan or type" /></Field>
          <Field label="Unit"><input className={inputCls} value={form.unit} onChange={set("unit")} placeholder="each, box, carton" /></Field>
          <Field label="Cost price" hint={product ? "Updated automatically when you receive stock" : "Starting cost"}>
            <input type="number" min="0" step="0.0001" className={inputCls} value={form.cost_price} onChange={set("cost_price")} />
          </Field>
          <Field label="Reorder point" hint="Alert when available stock drops to this"><input type="number" min="0" className={inputCls} value={form.reorder_point} onChange={set("reorder_point")} /></Field>
          <Field label="Reorder quantity" hint="Suggested amount to order"><input type="number" min="0" className={inputCls} value={form.reorder_quantity} onChange={set("reorder_quantity")} /></Field>
          {suppliers.length > 0 && (
            <Field label="Preferred supplier">
              <select className={inputCls} value={form.preferred_supplier_id} onChange={(e) => setForm({ ...form, preferred_supplier_id: e.target.value })}>
                <option value="">None</option>
                {suppliers.map((sup) => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
              </select>
            </Field>
          )}
        </div>
        <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <p className="md:col-span-3 text-xs font-bold uppercase text-gray-500 tracking-wide">Tobacco / vapor compliance</p>
          <Field label="Category" hint="State rules and excise taxes apply by category">
            <select className={inputCls} value={form.compliance_category} onChange={(e) => setForm({ ...form, compliance_category: e.target.value })}>
              {Object.entries(COMPLIANCE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Liquid per unit (ml)" hint="For per-ml excise taxes">
            <input type="number" min="0" step="0.001" className={inputCls} value={form.nicotine_ml} onChange={set("nicotine_ml")} disabled={form.compliance_category === "none"} />
          </Field>
          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mt-5">
            <input type="checkbox" checked={form.is_flavored} disabled={form.compliance_category === "none"} onChange={(e) => setForm({ ...form, is_flavored: e.target.checked })} /> Flavored (other than tobacco)
          </label>
        </div>
        {product && (product.flavors || []).length > 0 && <FlavorCodes productId={product.id} />}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
          <Field label="Image">
            <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm" />
          </Field>
          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4" />
            Visible in the store
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button disabled={saving} className={btnPrimary}>{saving ? "Saving..." : "Save product"}</button>
        </div>
      </form>
    </Modal>
  );
};

export const ProductsPage: React.FC = () => {
  const { companyId, can } = useBusiness();
  const canManage = can("products.manage");
  const [data, setData] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Product | null | undefined>(undefined);

  const load = useCallback(() => {
    if (!companyId) return;
    businessApi.products(companyId, { page, search, status }).then(setData).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, page, search, status]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load]);

  const toggleActive = async (p: Product) => {
    try {
      await businessApi.updateProduct(companyId!, p.id, { is_active: !p.is_active });
      toast.success(p.is_active ? "Product hidden from the store" : "Product is visible again");
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const remove = async (p: Product) => {
    if (!window.confirm(`Delete "${p.title}"?`)) return;
    try {
      const res = await businessApi.deleteProduct(companyId!, p.id);
      toast.success(res.message);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Your catalogue as customers see it"
        actions={canManage && <button onClick={() => setEditing(null)} className={btnPrimary}><Plus size={16} /> New product</button>}
      />
      <Card>
        <div className="flex flex-wrap gap-3 p-4 border-b border-gray-100">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input className={`${inputCls} pl-9`} placeholder="Search title, brand or SKU" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <select className={`${inputBase} w-auto`} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All products</option>
            <option value="active">Visible</option>
            <option value="inactive">Hidden</option>
          </select>
        </div>
        {!data ? (
          <Spinner />
        ) : data.products.length === 0 ? (
          <EmptyState
            icon={<Package size={40} />}
            title="No products yet"
            text={search || status ? "Try a different filter." : "Add your first product to start selling."}
            action={canManage && !search && <button onClick={() => setEditing(null)} className={btnPrimary}><Plus size={16} /> New product</button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50">
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3">Status</th>
                  {canManage && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.products.map((p: Product) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <img src={getProductImage(p.id)} alt="" className="w-10 h-10 rounded-lg object-cover bg-gray-100" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
                        <div>
                          <p className="font-semibold text-gray-900">{p.title}</p>
                          <p className="text-xs text-gray-500">{p.brand}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{p.sku || "—"}</td>
                    <td className="px-4 py-3 text-right font-bold">{p.price != null ? money(p.price) : <span className="text-amber-600 text-xs">No price</span>}</td>
                    <td className="px-4 py-3"><StatusBadge status={p.is_active ? "active" : "inactive"} /></td>
                    {canManage && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => setEditing(p)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" title="Edit"><Pencil size={16} /></button>
                          <button onClick={() => toggleActive(p)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" title={p.is_active ? "Hide" : "Show"}>
                            {p.is_active ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                          <button onClick={() => remove(p)} className="p-2 rounded-lg hover:bg-red-50 text-red-500" title="Delete"><Trash2 size={16} /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={data.currentPage} totalPages={data.totalPages} onChange={setPage} />
          </div>
        )}
      </Card>
      {editing !== undefined && <ProductForm product={editing} onClose={() => setEditing(undefined)} onSaved={load} />}
    </div>
  );
};
