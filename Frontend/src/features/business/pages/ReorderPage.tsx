import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCcw, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { supplyApi, Supplier } from "../api/supply.api";
import { Card, PageHeader, Spinner, EmptyState, money, inputBase, btnPrimary } from "../components/ui";

type Item = { product_id: number; flavor?: string | null; title: string; sku?: string; unit: string; available: number; incoming: number; reorder_point: number; suggested_quantity: number; unit_cost: number; supplier_sku?: string };
type Group = { supplier: { id: number; name: string } | null; items: Item[] };
const keyOf = (i: Item) => `${i.product_id}|${i.flavor || ""}`;

// Products at or below their reorder point (counting stock already on order), grouped by preferred supplier.
export const ReorderPage: React.FC = () => {
  const { companyId, can } = useBusiness();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [supplierFor, setSupplierFor] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);

  const load = () =>
    supplyApi.reorderSuggestions(companyId!).then((g: Group[]) => {
      setGroups(g);
      const q: Record<string, string> = {};
      const sel: Record<string, boolean> = {};
      g.forEach((grp) => grp.items.forEach((i) => { q[keyOf(i)] = String(i.suggested_quantity); sel[keyOf(i)] = true; }));
      setQty(q);
      setSelected(sel);
    }).catch((e) => toast.error(errorMessage(e)));

  useEffect(() => {
    load();
    supplyApi.suppliers(companyId!, { active: true }).then(setSuppliers).catch(() => {});
  }, [companyId]);

  const create = async () => {
    // One draft PO per supplier.
    const bySupplier = new Map<string, { product_id: number; flavor?: string | null; quantity: number }[]>();
    for (const g of groups || []) {
      for (const i of g.items) {
        if (!selected[keyOf(i)] || !(Number(qty[keyOf(i)]) > 0)) continue;
        const sid = g.supplier ? String(g.supplier.id) : supplierFor[keyOf(i)];
        if (!sid) return toast.error(`Choose a supplier for "${i.title}"`);
        if (!bySupplier.has(sid)) bySupplier.set(sid, []);
        bySupplier.get(sid)!.push({ product_id: i.product_id, flavor: i.flavor || undefined, quantity: Number(qty[keyOf(i)]) });
      }
    }
    if (!bySupplier.size) return toast.error("Select at least one product");
    setCreating(true);
    try {
      const res = await supplyApi.createFromSuggestions(companyId!, [...bySupplier].map(([supplier_id, items]) => ({ supplier_id, items })));
      toast.success(res.message);
      if (res.data.length === 1) navigate(`/business/purchase-orders/${res.data[0].id}`);
      else navigate("/business/purchase-orders?status=draft");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Reorder"
        subtitle="Products at or below their reorder point, counting stock already on order"
        actions={<>
          <button onClick={load} className="inline-flex items-center gap-2 text-sm font-semibold text-gray-600 hover:text-gray-900"><RefreshCcw size={16} /> Refresh</button>
          {can("purchasing.manage") && groups && groups.length > 0 && <button disabled={creating} onClick={create} className={btnPrimary}>{creating ? "Creating..." : "Create draft purchase orders"}</button>}
        </>}
      />
      {!groups ? <Spinner /> : groups.length === 0 ? (
        <Card><EmptyState icon={<CheckCircle2 size={40} />} title="Nothing to reorder" text="Set a reorder point on your products (Products → edit) to get suggestions here." /></Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.supplier?.id ?? "none"}>
              <div className="px-5 py-3 border-b border-gray-100 font-bold text-gray-900">
                {g.supplier ? g.supplier.name : <span className="text-amber-700">No preferred supplier: choose one per product</span>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50">
                    <th className="px-4 py-2 w-8" /><th className="px-4 py-2">Product</th><th className="px-4 py-2 text-right">Available</th><th className="px-4 py-2 text-right">On order</th>
                    <th className="px-4 py-2 text-right">Reorder at</th><th className="px-4 py-2">Order qty</th><th className="px-4 py-2 text-right">Unit cost</th>
                    {!g.supplier && <th className="px-4 py-2">Supplier</th>}
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {g.items.map((i) => (
                      <tr key={keyOf(i)}>
                        <td className="px-4 py-2"><input type="checkbox" checked={!!selected[keyOf(i)]} onChange={(e) => setSelected({ ...selected, [keyOf(i)]: e.target.checked })} aria-label={`Order ${i.title}`} /></td>
                        <td className="px-4 py-2"><p className="font-semibold">{i.title}</p><p className="text-xs text-gray-500">{[i.sku, i.supplier_sku && `supplier: ${i.supplier_sku}`].filter(Boolean).join(" · ")}</p></td>
                        <td className={`px-4 py-2 text-right font-bold ${i.available <= 0 ? "text-red-600" : "text-amber-700"}`}>{i.available}</td>
                        <td className="px-4 py-2 text-right">{i.incoming || "—"}</td>
                        <td className="px-4 py-2 text-right">{i.reorder_point}</td>
                        <td className="px-4 py-2"><input type="number" min={1} className={`${inputBase} w-24`} value={qty[keyOf(i)] || ""} onChange={(e) => setQty({ ...qty, [keyOf(i)]: e.target.value })} /></td>
                        <td className="px-4 py-2 text-right">{money(i.unit_cost)}</td>
                        {!g.supplier && (
                          <td className="px-4 py-2">
                            <select className={`${inputBase} w-44`} value={supplierFor[keyOf(i)] || ""} onChange={(e) => setSupplierFor({ ...supplierFor, [keyOf(i)]: e.target.value })}>
                              <option value="">Choose…</option>
                              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
