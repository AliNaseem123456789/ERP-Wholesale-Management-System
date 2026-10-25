import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Package, Plus, Search, Pencil, Trash2, Star, CheckSquare, Square } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { catalogApi, categoryTree, Category, CompanyBrand, PRODUCT_STATUSES } from "../api/catalog.api";
import { productImage } from "../../products/utils/getProductImage";
import {
  Card, PageHeader, Spinner, EmptyState, StatusBadge, Pagination, Modal, Field, FilterTabs,
  money, inputCls, btnPrimary, btnSecondary, inputBase,
} from "../components/ui";

type Row = {
  id: number; title: string; brand: string; sku?: string | null; price?: number | null; status: string; is_featured: boolean;
  image?: string | null; flavors?: string[]; min_order_qty: number; category_ids: number[];
};

const BULK_ACTIONS: { value: string; label: string }[] = [
  { value: "status", label: "Change status" },
  { value: "price_percent", label: "Change price by %" },
  { value: "price_amount", label: "Change price by amount" },
  { value: "add_category", label: "Add to category" },
  { value: "remove_category", label: "Remove from category" },
  { value: "brand", label: "Set brand" },
  { value: "featured", label: "Featured on/off" },
  { value: "min_order_qty", label: "Set minimum order" },
  { value: "visibility", label: "Visibility" },
];

const BulkModal: React.FC<{ ids: number[]; categories: Category[]; onClose: () => void; onDone: () => void }> = ({ ids, categories, onClose, onDone }) => {
  const { companyId } = useBusiness();
  const [action, setAction] = useState("status");
  const [value, setValue] = useState<string>("published");
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const tree = useMemo(() => categoryTree(categories), [categories]);

  useEffect(() => {
    setPreview(null);
    setValue(action === "status" ? "published" : action === "featured" ? "true" : action === "visibility" ? "public" : "");
  }, [action]);

  const body = () => ({ ids, action, value: action === "featured" ? value === "true" : value });
  const run = async (dry: boolean) => {
    setBusy(true);
    try {
      const r = await catalogApi.bulk(companyId!, { ...body(), preview: dry });
      if (dry) setPreview(r);
      else {
        toast.success(r.message);
        if (r.skipped?.length) toast.warning(r.skipped.slice(0, 3).map((s: any) => `${s.title}: ${s.reason}`).join("\n"));
        onDone();
        onClose();
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Edit ${ids.length} product(s)`} onClose={onClose}>
      <div className="space-y-4">
        <Field label="What to change">
          <select className={inputCls} value={action} onChange={(e) => setAction(e.target.value)}>
            {BULK_ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </Field>
        {action === "status" && (
          <Field label="New status" hint="Products that can't be published yet (no price, missing details) are skipped and listed.">
            <select className={inputCls} value={value} onChange={(e) => setValue(e.target.value)}>
              {PRODUCT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
        )}
        {(action === "price_percent" || action === "price_amount") && (
          <Field label={action === "price_percent" ? "Percent (e.g. 5 or -10)" : "Amount (e.g. 1.50 or -2)"}>
            <input type="number" step="0.01" className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
        )}
        {(action === "add_category" || action === "remove_category") && (
          <Field label="Category">
            <select className={inputCls} value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Choose…</option>
              {tree.map((c) => <option key={c.id} value={c.id}>{"  ".repeat(c.depth)}{c.name}</option>)}
            </select>
          </Field>
        )}
        {action === "brand" && <Field label="Brand"><input className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} /></Field>}
        {action === "featured" && (
          <Field label="Featured">
            <select className={inputCls} value={value} onChange={(e) => setValue(e.target.value)}><option value="true">Featured</option><option value="false">Not featured</option></select>
          </Field>
        )}
        {action === "min_order_qty" && <Field label="Minimum order quantity"><input type="number" min={1} className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} /></Field>}
        {action === "visibility" && (
          <Field label="Who can see them" hint="Customer groups are chosen per product.">
            <select className={inputCls} value={value} onChange={(e) => setValue(e.target.value)}><option value="public">Everyone</option><option value="groups">Only selected customer groups</option></select>
          </Field>
        )}
        {preview && (
          <div className="bg-gray-50 rounded-xl p-3 text-sm max-h-60 overflow-y-auto">
            <p className="font-bold mb-2">{preview.count} product(s) will change</p>
            {preview.changes.filter((c: any) => c.before !== undefined).slice(0, 50).map((c: any) => (
              <p key={c.id} className="flex justify-between gap-2"><span className="truncate">{c.title}</span><span className="shrink-0 text-gray-500">{String(c.before)} → <b className="text-gray-900">{String(c.after)}</b></span></p>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={() => run(true)} disabled={busy || value === ""}>Preview</button>
          <button className={btnPrimary} onClick={() => run(false)} disabled={busy || value === ""}>{busy ? "Working…" : "Apply"}</button>
        </div>
      </div>
    </Modal>
  );
};

export const ProductsPage: React.FC = () => {
  const { companyId, can } = useBusiness();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const canManage = can("products.manage");
  const [data, setData] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [categoryId, setCategoryId] = useState(params.get("category") || "");
  const [brandId, setBrandId] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<CompanyBrand[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    catalogApi.categories(companyId).then(setCategories).catch(() => {});
    catalogApi.brands(companyId).then(setBrands).catch(() => {});
  }, [companyId]);

  const load = useCallback(() => {
    if (!companyId) return;
    catalogApi.products(companyId, { page, search, status, category_id: categoryId, brand_id: brandId }).then(setData).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, page, search, status, categoryId, brandId]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => setSelected(new Set()), [page, search, status, categoryId, brandId]);

  const remove = async (p: Row) => {
    if (!window.confirm(`Delete "${p.title}"? Products with orders or stock history are archived instead.`)) return;
    try {
      toast.success((await catalogApi.remove(companyId!, p.id)).message);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const rows: Row[] = data?.products || [];
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const counts = data?.statusCounts || {};
  const tree = useMemo(() => categoryTree(categories.filter((c) => c.product_count)), [categories]);
  const catName = (id: number) => categories.find((c) => c.id === id)?.name;

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Your catalogue: products, variants, prices and what customers can see"
        actions={canManage && <button onClick={() => navigate("/business/products/new")} className={btnPrimary}><Plus size={16} /> New product</button>}
      />
      <Card>
        <div className="p-4 border-b border-gray-100 space-y-3">
          <FilterTabs
            value={status}
            onChange={(v) => { setStatus(v); setPage(1); }}
            options={[{ value: "", label: "All" }, ...PRODUCT_STATUSES.map((s) => ({ value: s.value, label: s.label, count: counts[s.value] }))]}
          />
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input className={`${inputCls} pl-9`} placeholder="Search title, brand, SKU or barcode (variants too)" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <select className={`${inputBase} w-auto`} value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }} aria-label="Category">
              <option value="">All categories</option>
              {tree.map((c) => <option key={c.id} value={c.id}>{"  ".repeat(c.depth)}{c.name} ({c.product_count})</option>)}
            </select>
            <select className={`${inputBase} w-auto`} value={brandId} onChange={(e) => { setBrandId(e.target.value); setPage(1); }} aria-label="Brand">
              <option value="">All brands</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          {canManage && selected.size > 0 && (
            <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 text-sm">
              <b>{selected.size} selected</b>
              <button className={btnPrimary} onClick={() => setBulkOpen(true)}>Edit selected</button>
              <button className="text-gray-500 hover:text-gray-800" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          )}
        </div>
        {!data ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Package size={40} />}
            title="No products here"
            text={search || status || categoryId || brandId ? "Try a different filter." : "Add your first product to start selling."}
            action={canManage && !search && <button onClick={() => navigate("/business/products/new")} className={btnPrimary}><Plus size={16} /> New product</button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50">
                  {canManage && (
                    <th className="pl-4 py-3 w-8">
                      <button onClick={() => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)))} aria-label="Select all on this page">
                        {allOnPage ? <CheckSquare size={16} /> : <Square size={16} />}
                      </button>
                    </th>
                  )}
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">Categories</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    {canManage && (
                      <td className="pl-4">
                        <button onClick={() => toggle(p.id)} aria-label={`Select ${p.title}`}>{selected.has(p.id) ? <CheckSquare size={16} className="text-blue-600" /> : <Square size={16} className="text-gray-400" />}</button>
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <button className="flex items-center gap-3 text-left" onClick={() => navigate(`/business/products/${p.id}`)}>
                        <img src={productImage(p)} alt="" className="w-10 h-10 rounded-lg object-cover bg-gray-100" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
                        <div>
                          <p className="font-semibold text-gray-900 flex items-center gap-1">{p.title}{p.is_featured && <Star size={12} className="text-amber-500 fill-amber-400" />}</p>
                          <p className="text-xs text-gray-500">{p.brand}{p.flavors?.length ? ` · ${p.flavors.length} variant(s)` : ""}{p.min_order_qty > 1 ? ` · min ${p.min_order_qty}` : ""}</p>
                        </div>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{p.sku || "—"}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 max-w-[220px] truncate">{p.category_ids.map(catName).filter(Boolean).join(", ") || "—"}</td>
                    <td className="px-4 py-3 text-right font-bold">{p.price != null ? money(p.price) : <span className="text-amber-600 text-xs">{p.flavors?.length ? "Per variant" : "No price"}</span>}</td>
                    <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => navigate(`/business/products/${p.id}`)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" title={canManage ? "Edit" : "View"}><Pencil size={16} /></button>
                        {canManage && <button onClick={() => remove(p)} className="p-2 rounded-lg hover:bg-red-50 text-red-500" title="Delete"><Trash2 size={16} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={data.currentPage} totalPages={data.totalPages} onChange={setPage} />
          </div>
        )}
      </Card>
      {bulkOpen && <BulkModal ids={[...selected]} categories={categories} onClose={() => setBulkOpen(false)} onDone={load} />}
    </div>
  );
};
