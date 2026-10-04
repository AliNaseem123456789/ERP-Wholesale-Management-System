import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Tags, Trash2, Percent, ListOrdered, Users } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { salesApi, CustomerGroup, PriceList, Promotion } from "../api/sales.api";
import { ProductPicker, PickedProduct } from "../components/supply";
import { Card, PageHeader, Spinner, EmptyState, StatusBadge, Modal, Field, FilterTabs, money, dateOnly, inputCls, btnPrimary, btnSecondary, btnDanger } from "../components/ui";

// ---------------- customer groups ----------------
const GroupForm: React.FC<{ group: CustomerGroup | null; lists: PriceList[]; onClose: () => void; onSaved: () => void }> = ({ group, lists, onClose, onSaved }) => {
  const { companyId } = useBusiness();
  const [form, setForm] = useState({
    name: group?.name || "",
    description: group?.description || "",
    discount_percent: String(group?.discount_percent ?? 0),
    price_list_id: group?.price_list_id ? String(group.price_list_id) : "",
  });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const body: any = { ...form, discount_percent: Number(form.discount_percent || 0), price_list_id: form.price_list_id || null };
      const res = group ? await salesApi.updateGroup(companyId!, group.id, body) : await salesApi.createGroup(companyId!, body);
      toast.success(res.message);
      onSaved();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Modal title={group ? `Edit ${group.name}` : "New customer group"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name *"><input required className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Gold resellers" /></Field>
        <Field label="Description"><input className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <Field label="Price list" hint="Prices on this list win over everything else for the group's customers">
          <select className={inputCls} value={form.price_list_id} onChange={(e) => setForm({ ...form, price_list_id: e.target.value })}>
            <option value="">None</option>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="Discount % off base price" hint="Used for products that aren't on a price list">
          <input type="number" min={0} max={100} step="0.01" className={inputCls} value={form.discount_percent} onChange={(e) => setForm({ ...form, discount_percent: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnSecondary}>Cancel</button><button className={btnPrimary}>Save group</button></div>
      </form>
    </Modal>
  );
};

const GroupsTab: React.FC<{ lists: PriceList[] }> = ({ lists }) => {
  const { companyId, can } = useBusiness();
  const canManage = can("pricing.manage");
  const [groups, setGroups] = useState<CustomerGroup[] | null>(null);
  const [editing, setEditing] = useState<CustomerGroup | null | undefined>(undefined);
  const load = useCallback(() => salesApi.groups(companyId!).then(setGroups).catch((e) => toast.error(errorMessage(e))), [companyId]);
  useEffect(() => {
    load();
  }, [load]);
  const remove = async (g: CustomerGroup) => {
    if (!window.confirm(`Delete group ${g.name}? Its customers go back to standard prices.`)) return;
    try {
      toast.success((await salesApi.deleteGroup(companyId!, g.id)).message);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Card>
      <div className="p-4 border-b border-gray-100 flex items-center justify-between">
        <p className="text-sm text-gray-600">Put customers in groups to give them a price list and/or a discount.</p>
        {canManage && <button onClick={() => setEditing(null)} className={btnPrimary}><Plus size={16} /> New group</button>}
      </div>
      {!groups ? <Spinner /> : groups.length === 0 ? <EmptyState icon={<Users size={40} />} title="No customer groups yet" /> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50"><th className="px-4 py-3">Group</th><th className="px-4 py-3">Price list</th><th className="px-4 py-3 text-right">Discount</th><th className="px-4 py-3 text-right">Customers</th><th /></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {groups.map((g) => (
              <tr key={g.id}>
                <td className="px-4 py-3"><p className="font-semibold">{g.name}</p><p className="text-xs text-gray-500">{g.description}</p></td>
                <td className="px-4 py-3">{g.price_list?.name || "—"}</td>
                <td className="px-4 py-3 text-right">{Number(g.discount_percent) ? `${g.discount_percent}%` : "—"}</td>
                <td className="px-4 py-3 text-right">{g.customerCount}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {canManage && <>
                    <button onClick={() => setEditing(g)} className="text-blue-600 font-semibold mr-3">Edit</button>
                    <button onClick={() => remove(g)} className="text-gray-400 hover:text-red-600" aria-label="Delete"><Trash2 size={15} /></button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing !== undefined && <GroupForm group={editing} lists={lists} onClose={() => setEditing(undefined)} onSaved={load} />}
    </Card>
  );
};

// ---------------- price lists ----------------
const PriceListDetail: React.FC<{ id: number; onClose: () => void; onChanged: () => void }> = ({ id, onClose, onChanged }) => {
  const { companyId, can } = useBusiness();
  const canManage = can("pricing.manage");
  const [list, setList] = useState<any>(null);
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [tiers, setTiers] = useState<{ min_quantity: string; price: string }[]>([{ min_quantity: "1", price: "" }]);
  const [meta, setMeta] = useState({ name: "", description: "", is_default: false, is_active: true });

  const load = useCallback(() => {
    salesApi.priceList(companyId!, id).then((l) => {
      setList(l);
      setMeta({ name: l.name, description: l.description || "", is_default: l.is_default, is_active: l.is_active });
    }).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, id]);
  useEffect(load, [load]);

  // group items by product
  const byProduct: { product: any; tiers: any[] }[] = [];
  for (const i of list?.items || []) {
    const g = byProduct.find((b) => b.product.id === i.product.id);
    if (g) g.tiers.push(i); else byProduct.push({ product: i.product, tiers: [i] });
  }

  const edit = (p: any, t: any[]) => {
    setProduct({ id: p.id, title: p.title, sku: p.sku });
    setTiers(t.map((x) => ({ min_quantity: String(x.min_quantity), price: String(x.price) })));
  };
  const savePrices = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) return toast.error("Choose a product");
    try {
      const clean = tiers.filter((t) => t.price !== "").map((t) => ({ min_quantity: Number(t.min_quantity || 1), price: Number(t.price) }));
      toast.success((await salesApi.setPrices(companyId!, id, product.id, clean)).message);
      setProduct(null);
      setTiers([{ min_quantity: "1", price: "" }]);
      load();
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const saveMeta = async () => {
    try {
      toast.success((await salesApi.updatePriceList(companyId!, id, meta)).message);
      load();
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete price list ${list.name}?`)) return;
    try {
      toast.success((await salesApi.deletePriceList(companyId!, id)).message);
      onChanged();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Modal title={list ? list.name : "Price list"} onClose={onClose} wide>
      {!list ? <Spinner /> : (
        <div className="space-y-5 text-sm">
          {canManage && (
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end bg-gray-50 rounded-xl p-3">
              <Field label="Name"><input className={inputCls} value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} /></Field>
              <Field label="Description"><input className={inputCls} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} /></Field>
              <button onClick={saveMeta} className={btnSecondary}>Save</button>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={meta.is_default} onChange={(e) => setMeta({ ...meta, is_default: e.target.checked })} /> Default list (applies to every customer without a group list)</label>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={meta.is_active} onChange={(e) => setMeta({ ...meta, is_active: e.target.checked })} /> Active</label>
            </div>
          )}

          {byProduct.length === 0 ? <p className="text-gray-500">No prices on this list yet.</p> : (
            <table className="w-full">
              <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="py-1">Product</th><th className="text-right">Base price</th><th>Volume prices</th><th /></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {byProduct.map(({ product: p, tiers: t }) => (
                  <tr key={p.id}>
                    <td className="py-2 font-semibold">{p.title}<span className="text-xs text-gray-400 ml-1">{p.sku}</span></td>
                    <td className="text-right text-gray-500">{money(p.price)}</td>
                    <td className="pl-4">{t.map((x) => <span key={x.id} className="inline-block mr-2 bg-blue-50 text-blue-800 rounded px-2 py-0.5 text-xs font-semibold">{x.min_quantity}+ @ {money(x.price)}</span>)}</td>
                    <td className="text-right whitespace-nowrap">{canManage && <>
                      <button onClick={() => edit(p, t)} className="text-blue-600 font-semibold mr-2">Edit</button>
                      <button onClick={() => salesApi.setPrices(companyId!, id, p.id, []).then(() => { load(); onChanged(); })} className="text-gray-400 hover:text-red-600" aria-label="Remove"><Trash2 size={14} /></button>
                    </>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {canManage && (
            <form onSubmit={savePrices} className="bg-gray-50 rounded-xl p-3 space-y-3">
              <Field label="Product"><ProductPicker value={product} onChange={setProduct} /></Field>
              <div className="space-y-2">
                {tiers.map((t, idx) => (
                  <div key={idx} className="flex items-end gap-2">
                    <Field label={idx === 0 ? "From quantity" : " "}><input type="number" min={1} className={`${inputCls} w-28`} value={t.min_quantity} onChange={(e) => setTiers((prev) => prev.map((x, i) => (i === idx ? { ...x, min_quantity: e.target.value } : x)))} /></Field>
                    <Field label={idx === 0 ? "Unit price" : " "}><input type="number" min={0} step="0.0001" required className={`${inputCls} w-32`} value={t.price} onChange={(e) => setTiers((prev) => prev.map((x, i) => (i === idx ? { ...x, price: e.target.value } : x)))} /></Field>
                    {tiers.length > 1 && <button type="button" onClick={() => setTiers((prev) => prev.filter((_, i) => i !== idx))} className="text-gray-400 hover:text-red-600 mb-2" aria-label="Remove tier"><Trash2 size={14} /></button>}
                  </div>
                ))}
                <button type="button" onClick={() => setTiers((prev) => [...prev, { min_quantity: String(Number(prev[prev.length - 1]?.min_quantity || 1) * 10), price: "" }])} className="text-xs font-bold text-blue-600">+ Add volume tier</button>
              </div>
              <div className="flex justify-end"><button className={btnPrimary}>Save prices</button></div>
            </form>
          )}
          {canManage && <div className="pt-2 border-t border-gray-100"><button onClick={remove} className={btnDanger}><Trash2 size={16} /> Delete price list</button></div>}
        </div>
      )}
    </Modal>
  );
};

const PriceListsTab: React.FC<{ lists: PriceList[] | null; reload: () => void }> = ({ lists, reload }) => {
  const { companyId, can } = useBusiness();
  const canManage = can("pricing.manage");
  const [viewing, setViewing] = useState<number | null>(null);
  const create = async () => {
    const name = window.prompt("Name of the new price list");
    if (!name) return;
    try {
      const res = await salesApi.createPriceList(companyId!, { name });
      reload();
      setViewing(res.data.id);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Card>
      <div className="p-4 border-b border-gray-100 flex items-center justify-between">
        <p className="text-sm text-gray-600">Fixed prices and volume breaks. A group's list wins; the default list applies to everyone else.</p>
        {canManage && <button onClick={create} className={btnPrimary}><Plus size={16} /> New price list</button>}
      </div>
      {!lists ? <Spinner /> : lists.length === 0 ? <EmptyState icon={<ListOrdered size={40} />} title="No price lists yet" /> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50"><th className="px-4 py-3">Price list</th><th className="px-4 py-3 text-right">Prices</th><th className="px-4 py-3 text-right">Groups</th><th className="px-4 py-3">Status</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {lists.map((l) => (
              <tr key={l.id} className="hover:bg-blue-50/40 cursor-pointer" onClick={() => setViewing(l.id)}>
                <td className="px-4 py-3"><p className="font-semibold">{l.name} {l.is_default && <span className="ml-1 text-[10px] font-bold uppercase bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Default</span>}</p><p className="text-xs text-gray-500">{l.description}</p></td>
                <td className="px-4 py-3 text-right">{l.itemCount}</td>
                <td className="px-4 py-3 text-right">{l.groupCount}</td>
                <td className="px-4 py-3"><StatusBadge status={l.is_active ? "active" : "inactive"} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {viewing && <PriceListDetail id={viewing} onClose={() => setViewing(null)} onChanged={reload} />}
    </Card>
  );
};

// ---------------- promotions ----------------
const PromoForm: React.FC<{ promo: Promotion | null; onClose: () => void; onSaved: () => void }> = ({ promo, onClose, onSaved }) => {
  const { companyId } = useBusiness();
  const [form, setForm] = useState({
    code: promo?.code || "",
    description: promo?.description || "",
    type: promo?.type || "percent",
    value: String(promo?.value ?? ""),
    min_order_amount: String(promo?.min_order_amount ?? 0),
    starts_at: promo?.starts_at?.slice(0, 10) || "",
    ends_at: promo?.ends_at?.slice(0, 10) || "",
    max_uses: promo?.max_uses == null ? "" : String(promo.max_uses),
    max_uses_per_customer: promo?.max_uses_per_customer == null ? "" : String(promo.max_uses_per_customer),
    is_active: promo?.is_active ?? true,
  });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const body = {
        ...form,
        value: form.type === "free_shipping" ? 0 : Number(form.value),
        min_order_amount: Number(form.min_order_amount || 0),
        starts_at: form.starts_at || null,
        ends_at: form.ends_at ? `${form.ends_at}T23:59:59` : null,
        max_uses: form.max_uses === "" ? null : Number(form.max_uses),
        max_uses_per_customer: form.max_uses_per_customer === "" ? null : Number(form.max_uses_per_customer),
      };
      const res = promo ? await salesApi.updatePromotion(companyId!, promo.id, body) : await salesApi.createPromotion(companyId!, body);
      toast.success(res.message);
      onSaved();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Modal title={promo ? `Edit ${promo.code}` : "New promo code"} onClose={onClose}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3">
        <Field label="Code *"><input required className={`${inputCls} uppercase`} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="SPRING10" /></Field>
        <Field label="Type">
          <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as any })}>
            <option value="percent">% off</option><option value="fixed">Fixed amount off</option><option value="free_shipping">Free shipping</option>
          </select>
        </Field>
        {form.type !== "free_shipping" && <Field label={form.type === "percent" ? "Percent off" : "Amount off"}><input type="number" min={0} step="0.01" required className={inputCls} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></Field>}
        <Field label="Minimum order"><input type="number" min={0} step="0.01" className={inputCls} value={form.min_order_amount} onChange={(e) => setForm({ ...form, min_order_amount: e.target.value })} /></Field>
        <Field label="Starts"><input type="date" className={inputCls} value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} /></Field>
        <Field label="Ends"><input type="date" className={inputCls} value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} /></Field>
        <Field label="Max uses (total)"><input type="number" min={1} className={inputCls} value={form.max_uses} onChange={(e) => setForm({ ...form, max_uses: e.target.value })} placeholder="Unlimited" /></Field>
        <Field label="Max uses per customer"><input type="number" min={1} className={inputCls} value={form.max_uses_per_customer} onChange={(e) => setForm({ ...form, max_uses_per_customer: e.target.value })} placeholder="Unlimited" /></Field>
        <div className="col-span-2"><Field label="Description (shown at checkout)"><input className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field></div>
        <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active</label>
        <div className="col-span-2 flex justify-end gap-2"><button type="button" onClick={onClose} className={btnSecondary}>Cancel</button><button className={btnPrimary}>Save</button></div>
      </form>
    </Modal>
  );
};

const PromotionsTab: React.FC = () => {
  const { companyId, can } = useBusiness();
  const canManage = can("pricing.manage");
  const [promos, setPromos] = useState<Promotion[] | null>(null);
  const [editing, setEditing] = useState<Promotion | null | undefined>(undefined);
  const load = useCallback(() => salesApi.promotions(companyId!).then(setPromos).catch((e) => toast.error(errorMessage(e))), [companyId]);
  useEffect(() => {
    load();
  }, [load]);
  const remove = async (p: Promotion) => {
    if (!window.confirm(`Delete ${p.code}?`)) return;
    try {
      toast.success((await salesApi.deletePromotion(companyId!, p.id)).message);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const describe = (p: Promotion) => (p.type === "percent" ? `${p.value}% off` : p.type === "fixed" ? `${money(p.value)} off` : "Free shipping");
  return (
    <Card>
      <div className="p-4 border-b border-gray-100 flex items-center justify-between">
        <p className="text-sm text-gray-600">Codes customers enter at checkout. Each code applies to your part of their cart.</p>
        {canManage && <button onClick={() => setEditing(null)} className={btnPrimary}><Plus size={16} /> New promo code</button>}
      </div>
      {!promos ? <Spinner /> : promos.length === 0 ? <EmptyState icon={<Percent size={40} />} title="No promo codes yet" /> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50"><th className="px-4 py-3">Code</th><th className="px-4 py-3">Offer</th><th className="px-4 py-3">Valid</th><th className="px-4 py-3 text-right">Used</th><th className="px-4 py-3 text-right">Discount given</th><th className="px-4 py-3">Status</th><th /></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {promos.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3 font-mono font-bold">{p.code}<p className="font-sans text-xs text-gray-500 font-normal">{p.description}</p></td>
                <td className="px-4 py-3">{describe(p)}{Number(p.min_order_amount) > 0 && <span className="text-xs text-gray-500"> · min {money(p.min_order_amount)}</span>}</td>
                <td className="px-4 py-3 text-xs">{p.starts_at || p.ends_at ? `${p.starts_at ? dateOnly(p.starts_at) : "now"} – ${p.ends_at ? dateOnly(p.ends_at) : "no end"}` : "Always"}</td>
                <td className="px-4 py-3 text-right">{p.uses_count}{p.max_uses ? ` / ${p.max_uses}` : ""}</td>
                <td className="px-4 py-3 text-right">{money(p.total_discount)}</td>
                <td className="px-4 py-3"><StatusBadge status={p.is_active ? "active" : "inactive"} /></td>
                <td className="px-4 py-3 text-right whitespace-nowrap">{canManage && <>
                  <button onClick={() => setEditing(p)} className="text-blue-600 font-semibold mr-3">Edit</button>
                  <button onClick={() => remove(p)} className="text-gray-400 hover:text-red-600" aria-label="Delete"><Trash2 size={15} /></button>
                </>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing !== undefined && <PromoForm promo={editing} onClose={() => setEditing(undefined)} onSaved={load} />}
    </Card>
  );
};

export const PricingPage: React.FC = () => {
  const { companyId } = useBusiness();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "groups";
  const [lists, setLists] = useState<PriceList[] | null>(null);
  const loadLists = useCallback(() => {
    salesApi.priceLists(companyId!).then(setLists).catch(() => setLists([]));
  }, [companyId]);
  useEffect(loadLists, [loadLists]);

  return (
    <div>
      <PageHeader title="Pricing & promotions" subtitle="Customer groups, price lists with volume breaks, and promo codes" />
      <div className="mb-4">
        <FilterTabs
          value={tab}
          onChange={(v) => setParams({ tab: v })}
          options={[{ value: "groups", label: "Customer groups" }, { value: "lists", label: "Price lists" }, { value: "promos", label: "Promo codes" }]}
        />
      </div>
      {tab === "groups" && <GroupsTab lists={lists || []} />}
      {tab === "lists" && <PriceListsTab lists={lists} reload={loadLists} />}
      {tab === "promos" && <PromotionsTab />}
      <p className="mt-4 text-xs text-gray-500 flex items-center gap-1"><Tags size={14} /> Price order for a customer: their group's price list → your default price list → base price minus the group discount.</p>
    </div>
  );
};
