import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Boxes, Search, SlidersHorizontal, ArrowLeftRight, ToggleLeft, ToggleRight, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { supplyApi, StockRow } from "../api/supply.api";
import { AdjustStockModal, TransferStockModal, useWarehouses, WarehouseSelect, PickedProduct, FlavorSelect } from "../components/supply";
import {
  Card, PageHeader, Spinner, EmptyState, StatusBadge, Pagination, Modal, Field,
  money, dateTime, dateOnly, inputBase, inputCls, btnPrimary, btnSecondary,
} from "../components/ui";

/** Moves stock between flavours in one warehouse (e.g. stock counted before flavours were tracked). */
const ReassignModal: React.FC<{ product: { id: number; title: string; flavors: string[]; unassigned: number }; onClose: () => void; onDone: () => void }> = ({ product, onClose, onDone }) => {
  const { companyId } = useBusiness();
  const warehouses = useWarehouses();
  const [form, setForm] = useState({ warehouse_id: "", from_flavor: "", to_flavor: "", quantity: String(product.unassigned || "") });
  useEffect(() => {
    if (!form.warehouse_id && warehouses.length) setForm((f) => ({ ...f, warehouse_id: String((warehouses.find((w) => w.is_default) || warehouses[0]).id) }));
  }, [warehouses]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      toast.success((await supplyApi.reassignFlavor(companyId!, { ...form, product_id: product.id, quantity: Number(form.quantity) })).message);
      onDone();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const picked = { id: product.id, title: product.title, flavors: product.flavors };
  return (
    <Modal title={`Assign flavour: ${product.title}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <p className="text-gray-600">Move stock from one flavour to another in the same warehouse. Use it for stock that was counted before you added flavours to this product.</p>
        <Field label="Warehouse"><WarehouseSelect value={form.warehouse_id} onChange={(v) => setForm({ ...form, warehouse_id: v })} warehouses={warehouses} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><FlavorSelect product={picked} value={form.from_flavor} allowUnassigned onChange={(v) => setForm({ ...form, from_flavor: v })} label="From flavour" /></Field>
          <Field label="To"><FlavorSelect product={picked} value={form.to_flavor} onChange={(v) => setForm({ ...form, to_flavor: v })} label="To flavour" /></Field>
        </div>
        <Field label="Quantity"><input type="number" min={1} required className={inputCls} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnSecondary}>Cancel</button><button className={btnPrimary}>Move stock</button></div>
      </form>
    </Modal>
  );
};

const MOVEMENT_LABEL: Record<string, string> = {
  receipt: "Received", adjustment: "Adjustment", sale: "Sold", transfer_in: "Transfer in", transfer_out: "Transfer out", return: "Customer return",
  supplier_return: "Returned to supplier",
};

const ProductStockDrawer: React.FC<{ productId: number; onClose: () => void }> = ({ productId, onClose }) => {
  const { companyId } = useBusiness();
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    supplyApi.productStock(companyId!, productId).then(setD).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, productId]);

  return (
    <Modal title={d ? d.product.title : "Stock"} onClose={onClose} wide>
      {!d ? (
        <Spinner />
      ) : (
        <div className="space-y-6 text-sm">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-[10px] uppercase font-bold text-gray-400">Average cost</p><p className="font-black text-lg">{money(d.product.cost_price)}</p></div>
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-[10px] uppercase font-bold text-gray-400">Reorder at</p><p className="font-black text-lg">{d.product.reorder_point || "—"}</p></div>
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-[10px] uppercase font-bold text-gray-400">Reorder qty</p><p className="font-black text-lg">{d.product.reorder_quantity || "—"}</p></div>
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-[10px] uppercase font-bold text-gray-400">Barcode / SKU</p><p className="font-semibold">{d.product.barcode || "—"} / {d.product.sku || "—"}</p></div>
          </div>

          {d.variants?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {d.variants.filter((v: any) => d.flavors.includes(v.flavor)).map((v: any) => (
                <span key={v.id} className="text-xs bg-blue-50 text-blue-800 rounded px-2 py-1">
                  <b>{v.flavor}</b>{v.barcode ? ` · ${v.barcode}` : ""}{v.sku ? ` · ${v.sku}` : ""}
                </span>
              ))}
            </div>
          )}
          <div>
            <h3 className="font-bold mb-2">By warehouse</h3>
            {d.levels.length === 0 ? <p className="text-gray-500">No stock recorded yet.</p> : (
              <table className="w-full">
                <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="py-1">Warehouse</th>{d.flavors?.length > 0 && <th>Flavour</th>}<th className="text-right">On hand</th><th className="text-right">Reserved</th><th className="text-right">Available</th></tr></thead>
                <tbody>{d.levels.map((l: any) => (
                  <tr key={l.id} className="border-b border-gray-50"><td className="py-1.5">{l.warehouse.name} ({l.warehouse.code})</td>{d.flavors?.length > 0 && <td>{l.flavor || <span className="text-amber-700">unassigned</span>}</td>}<td className="text-right">{l.on_hand}</td><td className="text-right">{l.reserved}</td><td className="text-right font-bold">{l.available}</td></tr>
                ))}</tbody>
              </table>
            )}
          </div>

          {d.lots.length > 0 && (
            <div>
              <h3 className="font-bold mb-2">Lots &amp; locations</h3>
              <table className="w-full">
                <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="py-1">Warehouse</th>{d.flavors?.length > 0 && <th>Flavour</th>}<th>Bin</th><th>Lot</th><th>Expiry</th><th className="text-right">Qty</th></tr></thead>
                <tbody>{d.lots.map((l: any) => (
                  <tr key={l.id} className="border-b border-gray-50"><td className="py-1.5">{l.warehouse.code}</td>{d.flavors?.length > 0 && <td>{l.flavor || "—"}</td>}<td>{l.bin || "—"}</td><td>{l.lot_number || "—"}</td><td>{dateOnly(l.expiry_date)}</td><td className="text-right font-bold">{l.quantity}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {d.incoming.length > 0 && (
            <div>
              <h3 className="font-bold mb-2">Incoming</h3>
              <ul className="space-y-1">{d.incoming.map((i: any) => (
                <li key={`${i.po_id}-${i.flavor}`}><Link to={`/business/purchase-orders/${i.po_id}`} className="text-blue-600 font-semibold hover:underline">{i.po_number}</Link> · {i.supplier}{i.flavor ? ` · ${i.flavor}` : ""} · {i.outstanding} expected {i.expected_date ? `by ${dateOnly(i.expected_date)}` : ""}</li>
              ))}</ul>
            </div>
          )}

          <div>
            <h3 className="font-bold mb-2">Recent movements</h3>
            <table className="w-full">
              <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="py-1">When</th><th>Type</th><th>Wh</th><th>Lot</th><th className="text-right">Qty</th><th className="text-right">Balance</th><th className="pl-4">By</th></tr></thead>
              <tbody>{d.movements.map((m: any) => (
                <tr key={m.id} className="border-b border-gray-50">
                  <td className="py-1.5 text-gray-500 whitespace-nowrap">{dateTime(m.created_at)}</td>
                  <td>{MOVEMENT_LABEL[m.type] || m.type}{m.flavor ? <span className="text-blue-700"> · {m.flavor}</span> : null}{m.reason ? <span className="text-gray-400"> · {m.reason.replace(/_/g, " ")}</span> : null}</td>
                  <td>{m.warehouse}</td><td>{m.lot_number || "—"}</td>
                  <td className={`text-right font-bold ${m.quantity < 0 ? "text-red-600" : "text-green-700"}`}>{m.quantity > 0 ? "+" : ""}{m.quantity}</td>
                  <td className="text-right">{m.balance_after}</td>
                  <td className="pl-4 text-gray-500 truncate max-w-[160px]">{m.user || "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
};

export const InventoryPage: React.FC = () => {
  const { companyId, can } = useBusiness();
  const canManage = can("inventory.manage");
  const warehouses = useWarehouses(false);
  const [settings, setSettings] = useState<{ tracking: boolean; lowStockEmails: boolean } | null>(null);
  const [warehouseId, setWarehouseId] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [detail, setDetail] = useState<number | null>(null);
  const [adjusting, setAdjusting] = useState<PickedProduct | null | undefined>(undefined);
  const [transferring, setTransferring] = useState<PickedProduct | null | undefined>(undefined);
  const [confirmTracking, setConfirmTracking] = useState(false);
  const [reassigning, setReassigning] = useState<any>(null);

  const load = useCallback(() => {
    supplyApi.stock(companyId!, { warehouse_id: warehouseId, search, filter, page }).then(setData).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, warehouseId, search, filter, page]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    supplyApi.inventorySettings(companyId!).then(setSettings).catch(() => {});
  }, [companyId]);

  const setTracking = async (tracking: boolean) => {
    try {
      const res = await supplyApi.updateInventorySettings(companyId!, { tracking });
      setSettings(res.data);
      toast.success(res.message);
      setConfirmTracking(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const s = data?.summary;

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Stock on hand across your warehouses"
        actions={
          canManage && (
            <>
              <button onClick={() => setTransferring(null)} className={btnSecondary}><ArrowLeftRight size={16} /> Transfer</button>
              <button onClick={() => setAdjusting(null)} className={btnPrimary}><SlidersHorizontal size={16} /> Adjust stock</button>
            </>
          )
        }
      />

      {settings && (
        <div className={`mb-4 flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 text-sm border ${settings.tracking ? "bg-green-50 border-green-200 text-green-900" : "bg-amber-50 border-amber-200 text-amber-900"}`}>
          {settings.tracking ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
          <span className="flex-1">
            {settings.tracking ? (
              <><b>Inventory tracking is on.</b> Confirming an order reserves stock, shipping deducts it, and customers can't order more than is available.</>
            ) : (
              <><b>Inventory tracking is off.</b> Orders don't change stock yet. Enter your stock counts first, then turn tracking on.</>
            )}
          </span>
          {canManage && (
            <button onClick={() => (settings.tracking ? setTracking(false) : setConfirmTracking(true))} className="font-bold underline">
              {settings.tracking ? "Turn off" : "Turn on"}
            </button>
          )}
        </div>
      )}

      {s && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          {[
            ["Products", s.products], ["Units on hand", s.units], ["Stock value", money(s.value)],
            ["Low stock", s.low], ["Out of stock", s.out],
          ].map(([label, value]) => (
            <Card key={String(label)} className="p-4">
              <p className="text-[10px] font-bold uppercase text-gray-400 tracking-wide">{label}</p>
              <p className="text-2xl font-black mt-1">{value}</p>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <div className="flex flex-wrap gap-3 p-4 border-b border-gray-100">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input className={`${inputCls} pl-9`} placeholder="Search title, brand, SKU or scan a barcode" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <WarehouseSelect value={warehouseId} onChange={(v) => { setWarehouseId(v); setPage(1); }} warehouses={warehouses} allowAll className={`${inputBase} w-auto`} />
          <select className={`${inputBase} w-auto`} value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}>
            <option value="all">All products</option>
            <option value="in">In stock</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </select>
        </div>
        {!data ? (
          <Spinner />
        ) : data.data.length === 0 ? (
          <EmptyState icon={<Boxes size={40} />} title="Nothing here" text={search || filter !== "all" ? "Try a different filter." : "Add products first, then record your opening stock with Adjust stock."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50">
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3 text-right">On hand</th>
                  <th className="px-4 py-3 text-right">Reserved</th>
                  <th className="px-4 py-3 text-right">Available</th>
                  <th className="px-4 py-3 text-right">Reorder at</th>
                  <th className="px-4 py-3 text-right">Avg cost</th>
                  <th className="px-4 py-3 text-right">Value</th>
                  <th className="px-4 py-3">Status</th>
                  {canManage && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.data.map((p: StockRow) => (
                  <tr key={p.id} className="hover:bg-blue-50/40 cursor-pointer" onClick={() => setDetail(p.id)}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">{p.title}</p>
                      <p className="text-xs text-gray-500">{[p.brand, p.sku, p.barcode].filter(Boolean).join(" · ")}</p>
                      {p.variants && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {p.variants.map((v) => (
                            <span key={v.flavor} className={`text-[11px] rounded px-1.5 py-0.5 ${v.available <= 0 ? "bg-red-50 text-red-700" : p.reorder_point > 0 && v.available <= p.reorder_point ? "bg-amber-50 text-amber-800" : "bg-gray-100 text-gray-700"}`}>
                              {v.flavor} <b>{v.available}</b>
                            </span>
                          ))}
                          {(p.unassigned || 0) > 0 && (
                            <button
                              onClick={(e) => { e.stopPropagation(); if (canManage) setReassigning({ id: p.id, title: p.title, flavors: p.variants!.map((v) => v.flavor), unassigned: p.unassigned }); }}
                              className="text-[11px] rounded px-1.5 py-0.5 bg-amber-100 text-amber-900 font-semibold"
                              title="Stock counted before flavours were tracked. Click to assign it to a flavour."
                            >
                              {p.unassigned} unassigned{canManage ? " · assign" : ""}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">{p.on_hand}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{p.reserved || "—"}</td>
                    <td className="px-4 py-3 text-right font-bold">{p.available}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{p.reorder_point || "—"}</td>
                    <td className="px-4 py-3 text-right">{money(p.cost_price)}</td>
                    <td className="px-4 py-3 text-right">{money(p.stock_value)}</td>
                    <td className="px-4 py-3"><StatusBadge status={p.status === "ok" ? "in stock" : p.status === "low" ? "low" : "out"} /></td>
                    {canManage && (
                      <td className="px-4 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setAdjusting({ id: p.id, title: p.title, sku: p.sku, cost_price: p.cost_price, flavors: p.variants?.map((v) => v.flavor) || [] })} className="text-xs font-bold text-blue-600 hover:underline mr-3">Adjust</button>
                        <button onClick={() => setTransferring({ id: p.id, title: p.title, sku: p.sku, flavors: p.variants?.map((v) => v.flavor) || [] })} className="text-xs font-bold text-gray-600 hover:underline">Move</button>
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

      {detail && <ProductStockDrawer productId={detail} onClose={() => setDetail(null)} />}
      {adjusting !== undefined && <AdjustStockModal product={adjusting} warehouseId={warehouseId} onClose={() => setAdjusting(undefined)} onDone={load} />}
      {reassigning && <ReassignModal product={reassigning} onClose={() => setReassigning(null)} onDone={load} />}
      {transferring !== undefined && <TransferStockModal product={transferring} onClose={() => setTransferring(undefined)} onDone={load} />}
      {confirmTracking && (
        <Modal title="Turn on inventory tracking?" onClose={() => setConfirmTracking(false)}>
          <div className="space-y-4 text-sm text-gray-700">
            <p className="flex gap-2"><AlertTriangle className="text-amber-500 shrink-0" size={18} /> Once on, customers can only order what's in stock, so products with no recorded stock will show as <b>out of stock</b>.</p>
            <p>Make sure you've entered your current stock (use <b>Adjust stock → Set counted quantity</b>, or receive your purchase orders) before turning this on.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmTracking(false)} className={btnSecondary}>Not yet</button>
              <button onClick={() => setTracking(true)} className={btnPrimary}>Turn on tracking</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
