// Categories (shared by the marketplace; companies can add them) and the brands this company sells.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FolderTree, Plus, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { catalogApi, categoryTree, Category, CompanyBrand, RELATIONSHIPS } from "../api/catalog.api";
import { Card, PageHeader, Spinner, EmptyState, Field, inputCls, btnPrimary } from "../components/ui";

export const CataloguePage: React.FC = () => {
  const { companyId, can } = useBusiness();
  const canManage = can("products.manage");
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [brands, setBrands] = useState<CompanyBrand[] | null>(null);
  const [onlyMine, setOnlyMine] = useState(true);
  const [catName, setCatName] = useState("");
  const [parentId, setParentId] = useState("");
  const [brandName, setBrandName] = useState("");
  const [relationship, setRelationship] = useState("reseller");
  const [matches, setMatches] = useState<{ id: number; name: string }[]>([]);

  const load = useCallback(() => {
    if (!companyId) return;
    catalogApi.categories(companyId).then(setCategories).catch((e) => toast.error(errorMessage(e)));
    catalogApi.brands(companyId).then(setBrands).catch((e) => toast.error(errorMessage(e)));
  }, [companyId]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!brandName.trim()) return setMatches([]);
    const t = setTimeout(() => catalogApi.searchBrands(companyId!, brandName.trim()).then(setMatches).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [brandName, companyId]);

  const tree = useMemo(() => {
    const all = categoryTree(categories || []);
    if (!onlyMine) return all;
    // keep categories with products and their parents
    const keep = new Set<number>();
    for (const c of categories || []) {
      if (!c.product_count) continue;
      let cur: Category | undefined = c;
      while (cur && !keep.has(cur.id)) {
        keep.add(cur.id);
        cur = (categories || []).find((x) => x.id === cur!.parent_id);
      }
    }
    return all.filter((c) => keep.has(c.id));
  }, [categories, onlyMine]);

  const addCategory = async () => {
    try {
      toast.success((await catalogApi.createCategory(companyId!, catName.trim(), parentId ? Number(parentId) : null)).message);
      setCatName("");
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const addBrand = async () => {
    try {
      await catalogApi.addBrand(companyId!, brandName.trim(), relationship);
      toast.success("Brand added to your list");
      setBrandName("");
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Categories & brands" subtitle="How your products are organised on the marketplace" />
      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold flex items-center gap-2"><FolderTree size={18} /> Categories</h2>
            <label className="text-xs flex items-center gap-1.5 text-gray-600"><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> Only ones I use</label>
          </div>
          {!categories ? <Spinner /> : tree.length === 0 ? <EmptyState title="No categories used yet" text="Add categories on each product, or create one below." /> : (
            <ul className="divide-y divide-gray-100 max-h-[460px] overflow-y-auto">
              {tree.map((c) => (
                <li key={c.id} className="py-2 flex justify-between text-sm" style={{ paddingLeft: c.depth * 18 }}>
                  <span className={c.depth ? "text-gray-700" : "font-semibold"}>{c.name}{c.own && <span className="ml-2 text-[10px] uppercase text-blue-600 font-bold">added by you</span>}</span>
                  {c.product_count ? <Link to={`/business/products?category=${c.id}`} className="text-xs text-gray-500">{c.product_count} product(s)</Link> : <span className="text-xs text-gray-300">—</span>}
                </li>
              ))}
            </ul>
          )}
          {canManage && (
            <div className="mt-4 bg-gray-50 rounded-xl p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Field label="New category"><input className={inputCls} value={catName} onChange={(e) => setCatName(e.target.value)} /></Field>
                <Field label="Inside">
                  <select className={inputCls} value={parentId} onChange={(e) => setParentId(e.target.value)}>
                    <option value="">Top level</option>
                    {categoryTree(categories || []).map((c) => <option key={c.id} value={c.id}>{"  ".repeat(c.depth)}{c.name}</option>)}
                  </select>
                </Field>
              </div>
              <div className="flex justify-between items-center gap-2">
                <p className="text-xs text-gray-400">Shared with the whole marketplace. Existing names are reused.</p>
                <button className={btnPrimary} disabled={!catName.trim()} onClick={addCategory}><Plus size={14} /> Add</button>
              </div>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-bold flex items-center gap-2 mb-3"><Tag size={18} /> Brands you sell</h2>
          {!brands ? <Spinner /> : brands.length === 0 ? <EmptyState title="No brands yet" /> : (
            <ul className="divide-y divide-gray-100 max-h-[460px] overflow-y-auto">
              {brands.map((b) => (
                <li key={b.id} className="py-2 flex items-center gap-2 text-sm">
                  <span className="flex-1 font-semibold">{b.name}<span className="ml-2 text-xs font-normal text-gray-400">{b.product_count} product(s)</span></span>
                  <select disabled={!canManage} className="px-2 py-1 border border-gray-200 rounded-lg text-xs" value={b.relationship}
                    onChange={async (e) => { try { await catalogApi.setBrandRelationship(companyId!, b.id, e.target.value); load(); } catch (err) { toast.error(errorMessage(err)); } }}>
                    {Object.entries(RELATIONSHIPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  {canManage && !b.product_count && (
                    <button className="p-1 text-gray-400 hover:text-red-600" aria-label={`Stop listing ${b.name}`}
                      onClick={async () => { try { await catalogApi.removeBrand(companyId!, b.id); load(); } catch (err) { toast.error(errorMessage(err)); } }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canManage && (
            <div className="mt-4 bg-gray-50 rounded-xl p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Brand" hint="Pick an existing brand to avoid duplicates">
                  <input className={inputCls} list="brand-search" value={brandName} onChange={(e) => setBrandName(e.target.value)} />
                  <datalist id="brand-search">{matches.map((m) => <option key={m.id} value={m.name} />)}</datalist>
                </Field>
                <Field label="You are its">
                  <select className={inputCls} value={relationship} onChange={(e) => setRelationship(e.target.value)}>
                    {Object.entries(RELATIONSHIPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
              </div>
              <div className="flex justify-end"><button className={btnPrimary} disabled={!brandName.trim()} onClick={addBrand}><Plus size={14} /> Add brand</button></div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default CataloguePage;
