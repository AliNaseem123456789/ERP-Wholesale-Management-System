// Shared pieces for the inventory / purchasing screens.
import React, { useEffect, useRef, useState } from "react";
import { ScanLine } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { businessApi, errorMessage } from "../api/business.api";
import { supplyApi, Warehouse, Bin, ADJUST_REASONS } from "../api/supply.api";
import { Field, Modal, inputCls, btnPrimary, btnSecondary } from "./ui";

export type PickedProduct = {
  id: number; title: string; sku?: string | null; barcode?: string | null; cost_price?: number; unit?: string;
  flavors?: string[] | null;
  /** set when a flavour barcode/SKU was scanned */
  flavor?: string | null;
};

export const hasFlavors = (p?: { flavors?: string[] | null } | null) => !!p?.flavors?.filter(Boolean).length;
export const withFlavor = (title?: string | null, flavor?: string | null) => (flavor ? `${title} (${flavor})` : title || "");

/** Flavour dropdown for products that have flavours (renders nothing otherwise). */
export const FlavorSelect: React.FC<{
  product: PickedProduct | null; value: string; onChange: (f: string) => void; allowUnassigned?: boolean; className?: string; label?: string;
}> = ({ product, value, onChange, allowUnassigned, className = inputCls, label = "Flavour" }) => {
  if (!hasFlavors(product)) return null;
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} required={!allowUnassigned}>
      <option value="">{allowUnassigned ? "No flavour (unassigned stock)" : "Choose flavour…"}</option>
      {product!.flavors!.filter(Boolean).map((f) => <option key={f} value={f}>{f}</option>)}
    </select>
  );
};

export const useWarehouses = (activeOnly = true) => {
  const { companyId } = useBusiness();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  useEffect(() => {
    if (companyId) supplyApi.warehouses(companyId, activeOnly).then(setWarehouses).catch(() => {});
  }, [companyId, activeOnly]);
  return warehouses;
};

/** Search-as-you-type product picker. Pressing Enter on an exact barcode/SKU picks it immediately (scanner friendly). */
export const ProductPicker: React.FC<{
  value: PickedProduct | null;
  onChange: (p: PickedProduct | null) => void;
  placeholder?: string;
  autoFocus?: boolean;
}> = ({ value, onChange, placeholder = "Search or scan a product", autoFocus }) => {
  const { companyId } = useBusiness();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickedProduct[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!q.trim() || value) return setResults([]);
    const t = setTimeout(() => {
      businessApi.products(companyId!, { search: q.trim() }).then((d) => setResults(d.products.slice(0, 8))).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q, companyId, value]);

  useEffect(() => {
    const close = (e: MouseEvent) => boxRef.current && !boxRef.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const scan = async () => {
    try {
      const p = await supplyApi.lookup(companyId!, q.trim());
      onChange(p);
      setQ("");
      setOpen(false);
    } catch {
      if (results.length === 1) {
        onChange(results[0]);
        setQ("");
      }
    }
  };

  if (value) {
    return (
      <div className="flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-2 bg-gray-50 text-sm">
        <span className="flex-1 font-semibold text-gray-900 truncate">
          {value.title}{value.flavor && <span className="text-blue-700"> · {value.flavor}</span>} {value.sku && <span className="text-gray-400 font-normal">· {value.sku}</span>}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault(); // inside a <label>, don't let the click be re-dispatched
            onChange(null);
          }}
          className="text-gray-400 hover:text-gray-700"
          aria-label="Clear product"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
      <input
        className={`${inputCls} pl-9`}
        placeholder={placeholder}
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (q.trim()) scan();
          }
        }}
      />
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto text-sm">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={(e) => {
                  // The picker often sits inside a <label>; preventDefault stops the browser from
                  // forwarding this click to the label's first button (which would clear the selection).
                  e.preventDefault();
                  onChange(p);
                  setQ("");
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 hover:bg-blue-50"
              >
                <span className="font-semibold text-gray-900">{p.title}</span>
                <span className="text-gray-400"> {[p.sku, p.barcode].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const WarehouseSelect: React.FC<{ value: string; onChange: (id: string) => void; warehouses: Warehouse[]; allowAll?: boolean; className?: string }> = ({
  value, onChange, warehouses, allowAll, className = inputCls,
}) => (
  <select className={className} value={value} onChange={(e) => onChange(e.target.value)}>
    {allowAll && <option value="">All warehouses</option>}
    {warehouses.map((w) => (
      <option key={w.id} value={String(w.id)}>
        {w.name} ({w.code}){w.is_default ? " · default" : ""}
      </option>
    ))}
  </select>
);

const useBins = (warehouseId: string) => {
  const { companyId } = useBusiness();
  const [bins, setBins] = useState<Bin[]>([]);
  useEffect(() => {
    if (!warehouseId) return setBins([]);
    supplyApi.bins(companyId!, Number(warehouseId)).then((b) => setBins(b.filter((x) => x.is_active))).catch(() => setBins([]));
  }, [companyId, warehouseId]);
  return bins;
};

/** Add / remove / count stock for one product in one warehouse. */
export const AdjustStockModal: React.FC<{ product?: PickedProduct | null; warehouseId?: string; onClose: () => void; onDone: () => void }> = ({
  product: initialProduct, warehouseId: initialWh, onClose, onDone,
}) => {
  const { companyId } = useBusiness();
  const warehouses = useWarehouses();
  const [product, setProduct] = useState<PickedProduct | null>(initialProduct || null);
  const [flavor, setFlavor] = useState(initialProduct?.flavor || "");
  useEffect(() => {
    setFlavor(product?.flavor || "");
  }, [product?.id, product?.flavor]);
  const [form, setForm] = useState({
    warehouse_id: initialWh || "", mode: "add", quantity: "", reason: "received",
    lot_number: "", expiry_date: "", bin_id: "", unit_cost: "", notes: "",
  });
  const bins = useBins(form.warehouse_id);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!form.warehouse_id && warehouses.length) {
      setForm((f) => ({ ...f, warehouse_id: String((warehouses.find((w) => w.is_default) || warehouses[0]).id) }));
    }
  }, [warehouses]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const v = e.target.value;
    setForm((f) => ({
      ...f,
      [k]: v,
      ...(k === "mode" ? { reason: v === "add" ? "received" : v === "remove" ? "damaged" : "stock_count" } : {}),
    }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) return toast.error("Choose a product");
    setSaving(true);
    try {
      const res = await supplyApi.adjust(companyId!, { ...form, product_id: product.id, flavor });
      toast.success(res.message);
      onDone();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Adjust stock" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Product"><ProductPicker value={product} onChange={setProduct} autoFocus={!product} /></Field>
        {hasFlavors(product) && (
          <Field label="Flavour" hint={form.mode === "add" ? "Stock is kept per flavour" : "Choose “unassigned” for stock counted before flavours were tracked"}>
            <FlavorSelect product={product} value={flavor} onChange={setFlavor} allowUnassigned={form.mode !== "add"} />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Warehouse"><WarehouseSelect value={form.warehouse_id} onChange={(v) => setForm({ ...form, warehouse_id: v, bin_id: "" })} warehouses={warehouses} /></Field>
          <Field label="Action">
            <select className={inputCls} value={form.mode} onChange={set("mode")}>
              <option value="add">Add stock</option>
              <option value="remove">Remove stock</option>
              <option value="set">Set counted quantity</option>
            </select>
          </Field>
          <Field label={form.mode === "set" ? "Counted quantity" : "Quantity"}>
            <input type="number" min={form.mode === "set" ? 0 : 1} step={1} required className={inputCls} value={form.quantity} onChange={set("quantity")} />
          </Field>
          <Field label="Reason">
            <select className={inputCls} value={form.reason} onChange={set("reason")}>
              {ADJUST_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
        </div>
        {form.mode === "add" && (
          <div className="grid grid-cols-2 gap-3 bg-gray-50 rounded-xl p-3">
            <Field label="Lot / batch #"><input className={inputCls} value={form.lot_number} onChange={set("lot_number")} placeholder="Optional" /></Field>
            <Field label="Expiry date"><input type="date" className={inputCls} value={form.expiry_date} onChange={set("expiry_date")} /></Field>
            <Field label="Bin">
              <select className={inputCls} value={form.bin_id} onChange={set("bin_id")}>
                <option value="">No bin</option>
                {bins.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
              </select>
            </Field>
            <Field label="Unit cost" hint="Updates the average cost">
              <input type="number" min="0" step="0.0001" className={inputCls} value={form.unit_cost} onChange={set("unit_cost")} placeholder={product?.cost_price != null ? String(product.cost_price) : ""} />
            </Field>
          </div>
        )}
        <Field label="Notes"><input className={inputCls} value={form.notes} onChange={set("notes")} /></Field>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button disabled={saving} className={btnPrimary}>{saving ? "Saving..." : "Save adjustment"}</button>
        </div>
      </form>
    </Modal>
  );
};

/** Move stock between two warehouses (lots keep their number & expiry). */
export const TransferStockModal: React.FC<{ product?: PickedProduct | null; onClose: () => void; onDone: () => void }> = ({ product, onClose, onDone }) => {
  const { companyId } = useBusiness();
  const warehouses = useWarehouses();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [lines, setLines] = useState<{ product: PickedProduct | null; flavor: string; quantity: string }[]>([{ product: product || null, flavor: product?.flavor || "", quantity: "" }]);
  const [notes, setNotes] = useState("");
  const [transit, setTransit] = useState({ on: false, carrier: "", tracking_number: "", expected_date: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (warehouses.length >= 2 && !from) {
      setFrom(String(warehouses[0].id));
      setTo(String(warehouses[1].id));
    }
  }, [warehouses]);

  if (warehouses.length < 2) {
    return (
      <Modal title="Transfer stock" onClose={onClose}>
        <p className="text-sm text-gray-600">You need at least two active warehouses to transfer stock. Add one under <b>Warehouses</b>.</p>
      </Modal>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const items = lines.filter((l) => l.product && Number(l.quantity) > 0).map((l) => ({ product_id: l.product!.id, flavor: l.flavor, quantity: Number(l.quantity) }));
    if (!items.length) return toast.error("Add at least one product and quantity");
    setSaving(true);
    try {
      const res = await supplyApi.createTransfer(companyId!, {
        from_warehouse_id: from, to_warehouse_id: to, items, notes,
        ...(transit.on ? { in_transit: true, carrier: transit.carrier, tracking_number: transit.tracking_number, expected_date: transit.expected_date || undefined } : {}),
      });
      toast.success(res.message);
      onDone();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Transfer stock" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><WarehouseSelect value={from} onChange={setFrom} warehouses={warehouses} /></Field>
          <Field label="To"><WarehouseSelect value={to} onChange={setTo} warehouses={warehouses} /></Field>
        </div>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_170px_110px_auto] gap-2 items-end">
            <Field label={i === 0 ? "Product" : ""}><ProductPicker value={l.product} onChange={(p) => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, product: p, flavor: p?.flavor || "" } : x)))} /></Field>
            <div>
              {hasFlavors(l.product) ? (
                <Field label="Flavour"><FlavorSelect product={l.product} value={l.flavor} allowUnassigned onChange={(f) => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, flavor: f } : x)))} /></Field>
              ) : <span className="block text-xs text-gray-400 pb-3">No flavours</span>}
            </div>
            <Field label={i === 0 ? "Quantity" : ""}>
              <input type="number" min={1} className={inputCls} value={l.quantity} onChange={(e) => { const v = e.target.value; setLines((prev) => prev.map((x, j) => (j === i ? { ...x, quantity: v } : x))); }} />
            </Field>
            <button type="button" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))} disabled={lines.length === 1} className="p-2 text-gray-400 hover:text-red-600 disabled:opacity-30" aria-label="Remove line">✕</button>
          </div>
        ))}
        <button type="button" onClick={() => setLines((prev) => [...prev, { product: null, flavor: "", quantity: "" }])} className="text-sm font-semibold text-blue-600 hover:underline">+ Add product</button>
        <div className="bg-gray-50 rounded-xl p-3 space-y-3">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={transit.on} onChange={(e) => setTransit({ ...transit, on: e.target.checked })} />
            Ship it (in transit): the stock arrives when the other warehouse receives it
          </label>
          {transit.on && (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Carrier"><input className={inputCls} value={transit.carrier} onChange={(e) => setTransit({ ...transit, carrier: e.target.value })} /></Field>
              <Field label="Tracking #"><input className={inputCls} value={transit.tracking_number} onChange={(e) => setTransit({ ...transit, tracking_number: e.target.value })} /></Field>
              <Field label="Expected"><input type="date" className={inputCls} value={transit.expected_date} onChange={(e) => setTransit({ ...transit, expected_date: e.target.value })} /></Field>
            </div>
          )}
        </div>
        <Field label="Notes"><input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button disabled={saving || from === to} className={btnPrimary}>{saving ? "Moving..." : transit.on ? "Ship transfer" : "Transfer"}</button>
        </div>
      </form>
    </Modal>
  );
};
