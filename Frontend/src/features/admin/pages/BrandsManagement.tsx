// Platform admin: brands (logo, description, featured), the companies that sell each one, merging duplicates,
// and moving one company's products of a brand to another company.
import React, { useEffect, useState } from "react";
import { Search, Pencil, Merge, Star, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { adminService } from "../api/admin.service";
import { adminCatalogApi } from "../api/adminCatalog.api";
import { errorMessage } from "../../business/api/business.api";
import { Card, Spinner, Modal, Field, inputCls, btnPrimary, btnSecondary } from "../../business/components/ui";

const RELATIONSHIP: Record<string, string> = { manufacturer: "manufacturer", authorized_distributor: "authorized distributor", distributor: "distributor", reseller: "reseller" };

const BrandForm: React.FC<{ brand: any; onClose: () => void; onSaved: () => void }> = ({ brand, onClose, onSaved }) => {
  const [f, setF] = useState({ name: brand.name, slug: brand.slug || "", logo_url: brand.logo_url || "", website: brand.website || "", description: brand.description || "", is_featured: !!brand.is_featured });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await adminCatalogApi.updateBrand(brand.id, f);
      toast.success("Brand saved");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Modal title={`Edit ${brand.name}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <Field label="Name"><input required className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Web address"><input className={inputCls} value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} /></Field>
        <Field label="Logo address"><input className={inputCls} value={f.logo_url} onChange={(e) => setF({ ...f, logo_url: e.target.value })} placeholder="https://…" /></Field>
        <Field label="Website"><input className={inputCls} value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://…" /></Field>
        <Field label="Description"><textarea rows={3} className={inputCls} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_featured} onChange={(e) => setF({ ...f, is_featured: e.target.checked })} /> Featured brand</label>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnSecondary}>Cancel</button><button className={btnPrimary}>Save</button></div>
      </form>
    </Modal>
  );
};

const MergeForm: React.FC<{ brand: any; onClose: () => void; onDone: () => void }> = ({ brand, onClose, onDone }) => {
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<any[]>([]);
  const [into, setInto] = useState<any>(null);
  useEffect(() => {
    if (!q.trim()) return setOptions([]);
    const t = setTimeout(() => adminCatalogApi.brands(q).then((r) => setOptions(r.filter((b) => b.id !== brand.id).slice(0, 20))).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q, brand.id]);
  const merge = async () => {
    try {
      toast.success((await adminCatalogApi.mergeBrand(brand.id, into.id)).message);
      onDone();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal title={`Merge "${brand.name}"`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600">Its {brand.productCount} product(s) and seller links move to the brand you choose; "{brand.name}" is then deleted.</p>
        <Field label="Find the brand to keep"><input className={inputCls} value={q} onChange={(e) => { setQ(e.target.value); setInto(null); }} /></Field>
        <div className="max-h-48 overflow-y-auto divide-y divide-gray-100">
          {options.map((b) => (
            <button key={b.id} onClick={() => setInto(b)} className={`block w-full text-left px-2 py-1.5 text-sm ${into?.id === b.id ? "bg-blue-50 font-bold" : "hover:bg-gray-50"}`}>{b.name} <span className="text-xs text-gray-400">({b.productCount})</span></button>
          ))}
        </div>
        <div className="flex justify-end gap-2"><button onClick={onClose} className={btnSecondary}>Cancel</button><button disabled={!into} onClick={merge} className={btnPrimary}>Merge into {into?.name || "…"}</button></div>
      </div>
    </Modal>
  );
};

const MoveForm: React.FC<{ brand: any; companies: any[]; onClose: () => void; onDone: () => void }> = ({ brand, companies, onClose, onDone }) => {
  const [from, setFrom] = useState(brand.company ? String(brand.company.id) : brand.sellers?.[0] ? String(brand.sellers[0].id) : "");
  const [to, setTo] = useState("");
  const move = async () => {
    try {
      toast.success((await adminCatalogApi.moveBrandProducts(brand.id, Number(to), Number(from))).message);
      onDone();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal title={`Move "${brand.name}" products`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600">Moves one company's products of this brand to another company (e.g. products imported under the wrong seller). Other sellers' products aren't touched.</p>
        <Field label="From">
          <select className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Choose…</option>
            {(brand.sellers || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="To">
          <select className={inputCls} value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose…</option>
            {companies.filter((c) => String(c.id) !== from).map((c) => <option key={c.id} value={c.id}>{c.name}{c.status !== "active" ? ` (${c.status})` : ""}</option>)}
          </select>
        </Field>
        <div className="flex justify-end gap-2"><button onClick={onClose} className={btnSecondary}>Cancel</button><button disabled={!from || !to} onClick={move} className={btnPrimary}>Move products</button></div>
      </div>
    </Modal>
  );
};

export const BrandsManagement: React.FC = () => {
  const [brands, setBrands] = useState<any[] | null>(null);
  const [companies, setCompanies] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [onlyFeatured, setOnlyFeatured] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [merge, setMerge] = useState<any>(null);
  const [move, setMove] = useState<any>(null);

  const load = () =>
    Promise.all([adminCatalogApi.brands(), adminService.getCompanies()])
      .then(([b, c]) => { setBrands(b); setCompanies(c); })
      .catch((e) => toast.error(errorMessage(e)));
  useEffect(() => { load(); }, []);

  const visible = (brands || []).filter((b) => (!search || b.name.toLowerCase().includes(search.toLowerCase())) && (!onlyFeatured || b.is_featured));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h2 className="text-xl font-black text-gray-900">Brands</h2>
          <p className="text-sm text-gray-500">A brand can be sold by many companies. Merge duplicates and choose featured brands here.</p>
        </div>
        <label className="text-sm flex items-center gap-1.5"><input type="checkbox" checked={onlyFeatured} onChange={(e) => setOnlyFeatured(e.target.checked)} /> Featured only</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input className={`${inputCls} pl-9 w-56`} placeholder="Search brands" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <Card>
        {!brands ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50">
                <th className="px-4 py-3">Brand</th><th className="px-4 py-3 text-center">Products</th><th className="px-4 py-3">Sold by</th><th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.slice(0, 500).map((b) => (
                <tr key={b.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      {b.logo_url && <img src={b.logo_url} alt="" className="w-7 h-7 object-contain rounded" />}
                      <span className="font-semibold text-gray-900">{b.name}</span>
                      {b.is_featured && <Star size={12} className="text-amber-500 fill-amber-400" />}
                    </div>
                    <span className="text-[11px] text-gray-400">/{b.slug}</span>
                  </td>
                  <td className="px-4 py-2 text-center">{b.productCount}</td>
                  <td className="px-4 py-2 text-xs text-gray-600">{(b.sellers || []).map((s: any) => `${s.name} (${RELATIONSHIP[s.relationship] || s.relationship})`).join(", ") || "—"}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <button className="p-1.5 hover:bg-gray-100 rounded-lg" title="Edit" onClick={() => setEdit(b)}><Pencil size={15} /></button>
                      <button className="p-1.5 hover:bg-gray-100 rounded-lg" title="Merge into another brand" onClick={() => setMerge(b)}><Merge size={15} /></button>
                      {(b.sellers || []).length > 0 && <button className="p-1.5 hover:bg-gray-100 rounded-lg" title="Move a company's products" onClick={() => setMove(b)}><ArrowRightLeft size={15} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {visible.length > 500 && <p className="p-3 text-xs text-gray-400">Showing 500 of {visible.length}. Search to narrow down.</p>}
      </Card>
      {edit && <BrandForm brand={edit} onClose={() => setEdit(null)} onSaved={load} />}
      {merge && <MergeForm brand={merge} onClose={() => setMerge(null)} onDone={load} />}
      {move && <MoveForm brand={move} companies={companies} onClose={() => setMove(null)} onDone={load} />}
    </div>
  );
};
