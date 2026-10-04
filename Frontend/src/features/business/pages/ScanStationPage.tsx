import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScanLine, Camera, X, Search, ClipboardCheck, PackageCheck, PackageOpen, Minus, Plus, Trash2, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage, businessApi } from "../api/business.api";
import { supplyApi } from "../api/supply.api";
import { opsApi } from "../api/ops.api";
import { useWarehouses, WarehouseSelect } from "../components/supply";
import { Card, PageHeader, Spinner, EmptyState, StatusBadge, Field, FilterTabs, dateOnly, inputCls, inputBase, btnPrimary, btnSecondary } from "../components/ui";

// Short audible feedback for scans (no audio files needed).
const beep = (ok: boolean) => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 880 : 220;
    g.gain.value = 0.08;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.08 : 0.25));
    setTimeout(() => ctx.close(), 400);
  } catch {
    /* no audio */
  }
};

/** Camera scanning with the browser's built-in BarcodeDetector (Chrome / Android). */
const CameraScanner: React.FC<{ onCode: (code: string) => void; onClose: () => void }> = ({ onCode, onClose }) => {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stream: MediaStream | null = null;
    let stop = false;
    let last = "";
    (async () => {
      try {
        const Detector = (window as any).BarcodeDetector;
        if (!Detector) throw new Error("This browser can't read barcodes with the camera. Use Chrome on Android, or a USB/Bluetooth scanner.");
        const detector = new Detector();
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const loop = async () => {
          if (stop || !video.current) return;
          try {
            const codes = await detector.detect(video.current);
            const value = codes[0]?.rawValue;
            if (value && value !== last) {
              last = value;
              onCode(value);
              setTimeout(() => { last = ""; }, 1500);
            }
          } catch { /* keep trying */ }
          setTimeout(loop, 250);
        };
        loop();
      } catch (e: any) {
        setError(e?.message || "Camera not available");
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  return (
    <div className="relative bg-black rounded-xl overflow-hidden mb-3">
      {error ? <p className="text-white text-sm p-4">{error}</p> : <video ref={video} className="w-full max-h-64 object-cover" muted playsInline />}
      <div className="absolute inset-x-8 top-1/2 h-0.5 bg-red-500/80" />
      <button onClick={onClose} className="absolute top-2 right-2 bg-white/90 rounded-full p-1" aria-label="Close camera"><X size={16} /></button>
    </div>
  );
};

/** Keyboard-wedge scanners type the code and press Enter; people can type too. */
export const ScanInput: React.FC<{ onScan: (code: string) => void; placeholder?: string; disabled?: boolean }> = ({ onScan, placeholder = "Scan a barcode or type a SKU", disabled }) => {
  const [value, setValue] = useState("");
  const [camera, setCamera] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, [disabled]);
  const submit = (code: string) => {
    const c = code.trim();
    if (!c) return;
    onScan(c);
    setValue("");
    ref.current?.focus();
  };
  return (
    <div>
      {camera && <CameraScanner onCode={submit} onClose={() => setCamera(false)} />}
      <form onSubmit={(e) => { e.preventDefault(); submit(value); }} className="flex gap-2">
        <div className="relative flex-1">
          <ScanLine size={18} className="absolute left-3 top-3 text-gray-400" />
          <input ref={ref} disabled={disabled} aria-label="Scan" className={`${inputBase} w-full pl-10 py-2.5 text-base font-mono`} placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
        </div>
        <button type="button" onClick={() => setCamera(!camera)} className={btnSecondary} aria-label="Scan with camera"><Camera size={16} /></button>
        <button className={btnPrimary}>Enter</button>
      </form>
    </div>
  );
};

// ---------------- lookup ----------------
const Lookup: React.FC = () => {
  const { companyId } = useBusiness();
  const [d, setD] = useState<any>(null);
  const scan = async (code: string) => {
    try {
      setD(await opsApi.scanLookup(companyId!, code));
      beep(true);
    } catch (err) {
      beep(false);
      setD(null);
      toast.error(errorMessage(err));
    }
  };
  return (
    <div className="space-y-3">
      <Card className="p-4"><ScanInput onScan={scan} /></Card>
      {d && (
        <Card className="p-5 text-sm space-y-3">
          <div>
            <p className="text-lg font-black text-gray-900">{d.product.title}{d.flavor ? ` · ${d.flavor}` : ""}</p>
            <p className="text-gray-500 font-mono">{[d.product.sku, d.product.barcode].filter(Boolean).join(" · ")}{!d.product.is_active && <span className="ml-2"><StatusBadge status="inactive" /></span>}</p>
          </div>
          <table className="w-full">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="py-1">Warehouse</th><th>Flavour</th><th className="text-right">On hand</th><th className="text-right">Reserved</th><th className="text-right">Available</th></tr></thead>
            <tbody>{d.levels.length === 0 ? <tr><td colSpan={5} className="py-3 text-gray-400">No stock anywhere</td></tr> : d.levels.map((l: any, i: number) => (
              <tr key={i} className="border-b border-gray-50"><td className="py-1.5 font-semibold">{l.warehouse.code}</td><td>{l.flavor || "—"}</td><td className="text-right">{l.on_hand}</td><td className="text-right text-gray-500">{l.reserved}</td><td className="text-right font-bold">{l.available}</td></tr>
            ))}</tbody>
          </table>
          {d.lots.length > 0 && (
            <div>
              <p className="text-[10px] uppercase font-bold text-gray-400 mb-1">Lots & bins (pick from the top)</p>
              {d.lots.map((l: any) => <p key={l.id} className="text-gray-700">{l.warehouse}{l.bin ? ` / ${l.bin}` : ""} · {l.lot_number || "no lot"}{l.flavor ? ` · ${l.flavor}` : ""} · {l.quantity} units{l.expiry_date ? ` · expires ${dateOnly(l.expiry_date)}` : ""}</p>)}
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

// ---------------- stock count ----------------
type CountLine = { key: string; product_id: number; title: string; flavor: string; counted: number };
const Count: React.FC = () => {
  const { companyId, can } = useBusiness();
  const warehouses = useWarehouses();
  const [wh, setWh] = useState("");
  const [lines, setLines] = useState<CountLine[]>([]);
  const [last, setLast] = useState<string>("");
  const [result, setResult] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!wh && warehouses.length) setWh(String((warehouses.find((w) => w.is_default) || warehouses[0]).id)); }, [warehouses]);
  const scan = async (code: string) => {
    try {
      const d = await opsApi.scanLookup(companyId!, code);
      if (d.product.flavors?.length && d.flavor === null) {
        beep(false);
        return toast.error(`"${d.product.title}" has flavours: scan the flavour's own barcode`);
      }
      const flavor = d.flavor || "";
      const key = `${d.product.id}:${flavor}`;
      setLines((ls) => {
        const found = ls.find((l) => l.key === key);
        return found ? ls.map((l) => (l.key === key ? { ...l, counted: l.counted + 1 } : l)) : [{ key, product_id: d.product.id, title: d.product.title, flavor, counted: 1 }, ...ls];
      });
      setLast(key);
      setResult(null);
      beep(true);
    } catch (err) {
      beep(false);
      toast.error(errorMessage(err));
    }
  };
  const save = async () => {
    if (!window.confirm(`Set ${lines.length} item(s) to the counted quantities in this warehouse? Items you didn't scan aren't changed.`)) return;
    setBusy(true);
    try {
      const r = await opsApi.scanCount(companyId!, { warehouse_id: Number(wh), lines: lines.map((l) => ({ product_id: l.product_id, flavor: l.flavor, counted: l.counted })) });
      toast.success(r.message);
      setResult(r.data);
      setLines([]);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  if (!can("inventory.manage")) return <Card className="p-6 text-sm text-gray-500">Counting stock needs inventory permission.</Card>;
  return (
    <div className="space-y-3">
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <Field label="Warehouse"><WarehouseSelect value={wh} onChange={setWh} warehouses={warehouses} /></Field>
          <p className="text-sm text-gray-500 pb-2 flex-1">Scan each unit (or scan once and type the quantity). Only the items you scan are updated.</p>
        </div>
        <ScanInput onScan={scan} />
      </Card>
      {lines.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">Item</th><th className="w-48">Counted</th><th className="w-10" /></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.key} className={`border-b border-gray-50 ${last === l.key ? "bg-green-50" : ""}`}>
                <td className="px-4 py-2 font-semibold">{l.title}{l.flavor && <span className="text-gray-500 font-normal"> · {l.flavor}</span>}</td>
                <td>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setLines(lines.map((x) => (x.key === l.key ? { ...x, counted: Math.max(0, x.counted - 1) } : x)))} className="p-1 rounded hover:bg-gray-100" aria-label="Less"><Minus size={14} /></button>
                    <input type="number" min="0" aria-label={`${l.title} counted`} className={`${inputBase} w-20 text-center`} value={l.counted} onChange={(e) => setLines(lines.map((x) => (x.key === l.key ? { ...x, counted: Math.max(0, parseInt(e.target.value, 10) || 0) } : x)))} />
                    <button onClick={() => setLines(lines.map((x) => (x.key === l.key ? { ...x, counted: x.counted + 1 } : x)))} className="p-1 rounded hover:bg-gray-100" aria-label="More"><Plus size={14} /></button>
                  </div>
                </td>
                <td><button onClick={() => setLines(lines.filter((x) => x.key !== l.key))} className="text-gray-400 hover:text-red-600" aria-label="Remove"><Trash2 size={14} /></button></td>
              </tr>
            ))}</tbody>
          </table>
          <div className="flex justify-end p-3"><button disabled={busy} onClick={save} className={btnPrimary}><ClipboardCheck size={16} /> Save count</button></div>
        </Card>
      )}
      {result && (
        <Card className="p-4 text-sm">
          <p className="font-bold mb-2">Count saved</p>
          {result.map((r) => <p key={r.product_id + r.title} className={r.delta ? "font-semibold" : "text-gray-500"}>{r.title}: {r.before} → {r.counted} {r.delta ? `(${r.delta > 0 ? "+" : ""}${r.delta})` : "(no change)"}</p>)}
        </Card>
      )}
    </div>
  );
};

// ---------------- pick & pack ----------------
const Pack: React.FC = () => {
  const { companyId, can } = useBusiness();
  const [orders, setOrders] = useState<any[] | null>(null);
  const [sheet, setSheet] = useState<any>(null);
  const [scanned, setScanned] = useState<Record<string, number>>({});
  const [tracking, setTracking] = useState("");
  const loadOrders = useCallback(() => {
    Promise.all(["confirmed", "processing"].map((s) => businessApi.orders(companyId!, { status: s }).then((r: any) => r.orders || r.data || []))).then((lists) => setOrders(lists.flat())).catch(() => setOrders([]));
  }, [companyId]);
  useEffect(loadOrders, [loadOrders]);
  const open = async (id: number) => {
    try {
      setSheet(await opsApi.packSheet(companyId!, id));
      setScanned({});
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const scan = (code: string) => {
    const c = code.toLowerCase();
    const matches = sheet.lines.filter((l: any) => l.codes.some((x: string) => x.toLowerCase() === c));
    if (!matches.length) {
      beep(false);
      return toast.error(`${code} isn't on this order`);
    }
    // a product-level code can match several flavour lines: fill the first one still open
    const line = matches.find((l: any) => (scanned[l.order_item_id] || 0) < l.quantity) || matches[0];
    const n = (scanned[line.order_item_id] || 0) + 1;
    if (n > line.quantity) {
      beep(false);
      return toast.error(`Too many: ${line.title} needs ${line.quantity}`);
    }
    setScanned({ ...scanned, [line.order_item_id]: n });
    beep(true);
  };
  const done = sheet && sheet.lines.every((l: any) => (scanned[l.order_item_id] || 0) === l.quantity);
  const finish = async (ship: boolean) => {
    try {
      const r = await opsApi.verifyPack(companyId!, sheet.id, Object.entries(scanned).map(([order_item_id, quantity]) => ({ order_item_id: Number(order_item_id), quantity })));
      toast.success(r.message);
      if (ship) {
        await businessApi.setOrderStatus(companyId!, sheet.id, { status: "shipped", tracking_number: tracking || undefined });
        toast.success(`${sheet.order_number} shipped`);
      }
      setSheet(null);
      setTracking("");
      loadOrders();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  if (!sheet) {
    return (
      <Card className="overflow-hidden">
        <p className="font-bold px-4 pt-4 pb-2">Orders to pack</p>
        {!orders ? <Spinner /> : orders.length === 0 ? <EmptyState icon={<PackageOpen size={32} />} title="Nothing waiting to be packed" text="Confirmed orders appear here." /> : (
          <table className="w-full text-sm"><tbody>{orders.map((o) => (
            <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => open(o.id)}>
              <td className="px-4 py-2 font-mono">{o.order_number}</td><td>{o.business_name || o.customer_email}</td><td><StatusBadge status={o.status} /></td><td className="text-right px-4 text-blue-700 font-semibold">Pack →</td>
            </tr>
          ))}</tbody></table>
        )}
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-3"><p className="text-lg font-black">{sheet.order_number}</p><span className="text-gray-500">{sheet.customer}</span><button onClick={() => setSheet(null)} className="ml-auto text-sm text-gray-500 hover:text-gray-900">Back to list</button></div>
        {sheet.compliance?.flags?.length > 0 && <div className="bg-amber-50 text-amber-900 rounded-lg px-3 py-2 text-sm">{sheet.compliance.flags.map((f: string) => <p key={f} className="flex items-center gap-2"><AlertTriangle size={14} /> {f}</p>)}</div>}
        <ScanInput onScan={scan} placeholder="Scan each item as you pack it" />
      </Card>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">Item</th><th>SKU</th><th className="text-right px-4">Packed</th></tr></thead>
          <tbody>{sheet.lines.map((l: any) => {
            const n = scanned[l.order_item_id] || 0;
            const ok = n === l.quantity;
            return (
              <tr key={l.order_item_id} className={`border-b border-gray-50 ${ok ? "bg-green-50" : ""}`}>
                <td className="px-4 py-2 font-semibold">{ok && <CheckCircle2 size={14} className="inline text-green-600 mr-1" />}{l.title}</td>
                <td className="font-mono text-gray-500">{l.sku}</td>
                <td className={`text-right px-4 font-bold ${ok ? "text-green-700" : ""}`}>{n} / {l.quantity}</td>
              </tr>
            );
          })}</tbody>
        </table>
        <div className="flex flex-wrap gap-2 items-end justify-end p-3">
          {can("orders.fulfil") || can("orders.manage") ? (
            <>
              <Field label="Tracking number"><input className={inputBase} value={tracking} onChange={(e) => setTracking(e.target.value)} /></Field>
              <button disabled={!done} onClick={() => finish(false)} className={btnSecondary}>Verify only</button>
              <button disabled={!done} onClick={() => finish(true)} className={btnPrimary}><PackageCheck size={16} /> Verify & ship</button>
            </>
          ) : null}
        </div>
      </Card>
    </div>
  );
};

// ---------------- receive ----------------
const Receive: React.FC = () => {
  const { companyId } = useBusiness();
  const [pos, setPos] = useState<any[] | null>(null);
  const [sheet, setSheet] = useState<any>(null);
  const [got, setGot] = useState<Record<string, number>>({});
  const loadPos = useCallback(() => {
    Promise.all(["sent", "partially_received"].map((s) => supplyApi.purchaseOrders(companyId!, { status: s }).then((r: any) => r.data || []))).then((l) => setPos(l.flat())).catch(() => setPos([]));
  }, [companyId]);
  useEffect(loadPos, [loadPos]);
  const scan = (code: string) => {
    const c = code.toLowerCase();
    const matches = sheet.lines.filter((l: any) => l.codes.some((x: string) => x.toLowerCase() === c));
    if (!matches.length) {
      beep(false);
      return toast.error(`${code} isn't on this purchase order`);
    }
    const line = matches.find((l: any) => (got[l.item_id] || 0) < l.outstanding) || matches[0];
    if ((got[line.item_id] || 0) + 1 > line.outstanding) {
      beep(false);
      return toast.error(`Only ${line.outstanding} of ${line.title} expected`);
    }
    setGot({ ...got, [line.item_id]: (got[line.item_id] || 0) + 1 });
    beep(true);
  };
  const receive = async () => {
    const lines = Object.entries(got).filter(([, q]) => q > 0).map(([item_id, quantity]) => ({ item_id: Number(item_id), quantity }));
    if (!lines.length) return toast.error("Scan what arrived first");
    try {
      const r = await supplyApi.receivePurchaseOrder(companyId!, sheet.id, { lines });
      toast.success(r.message || "Received");
      setSheet(null);
      loadPos();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  if (!sheet) {
    return (
      <Card className="overflow-hidden">
        <p className="font-bold px-4 pt-4 pb-2">Deliveries expected</p>
        {!pos ? <Spinner /> : pos.length === 0 ? <EmptyState icon={<PackageOpen size={32} />} title="No purchase orders waiting" /> : (
          <table className="w-full text-sm"><tbody>{pos.map((p) => (
            <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => opsApi.receivingSheet(companyId!, p.id).then((s) => { setSheet(s); setGot({}); }).catch((e) => toast.error(errorMessage(e)))}>
              <td className="px-4 py-2 font-mono">{p.po_number}</td><td>{p.supplier_name}</td><td><StatusBadge status={p.status} /></td><td className="text-right px-4 text-blue-700 font-semibold">Receive →</td>
            </tr>
          ))}</tbody></table>
        )}
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-3"><p className="text-lg font-black">{sheet.po_number}</p><span className="text-gray-500">{sheet.supplier} → {sheet.warehouse?.code}</span><button onClick={() => setSheet(null)} className="ml-auto text-sm text-gray-500 hover:text-gray-900">Back to list</button></div>
        <ScanInput onScan={scan} placeholder="Scan each item as you unpack it" />
      </Card>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">Item</th><th className="text-right">Ordered</th><th className="text-right">Already in</th><th className="text-right px-4">Scanned now</th></tr></thead>
          <tbody>{sheet.lines.map((l: any) => (
            <tr key={l.item_id} className={`border-b border-gray-50 ${(got[l.item_id] || 0) === l.outstanding && l.outstanding > 0 ? "bg-green-50" : ""}`}>
              <td className="px-4 py-2 font-semibold">{l.title}</td><td className="text-right">{l.ordered}</td><td className="text-right text-gray-500">{l.received}</td>
              <td className="text-right px-4 font-bold">{got[l.item_id] || 0} / {l.outstanding}</td>
            </tr>
          ))}</tbody>
        </table>
        <div className="flex justify-end p-3"><button onClick={receive} className={btnPrimary}><PackageCheck size={16} /> Receive scanned items</button></div>
      </Card>
    </div>
  );
};

export const ScanStationPage: React.FC = () => {
  const { can } = useBusiness();
  const tabs = [
    { value: "lookup", label: "Look up" },
    ...(can("inventory.manage") ? [{ value: "count", label: "Stock count" }] : []),
    ...(can("orders.fulfil") || can("orders.manage") ? [{ value: "pack", label: "Pick & pack" }] : []),
    ...(can("purchasing.receive") || can("purchasing.manage") ? [{ value: "receive", label: "Receive" }] : []),
  ];
  const [tab, setTab] = useState("lookup");
  return (
    <div className="max-w-4xl">
      <PageHeader title="Scan station" subtitle="Use a USB / Bluetooth barcode scanner, a phone camera, or type SKUs" />
      <div className="mb-3"><FilterTabs value={tab} onChange={setTab} options={tabs} /></div>
      {tab === "lookup" && <Lookup />}
      {tab === "count" && <Count />}
      {tab === "pack" && <Pack />}
      {tab === "receive" && <Receive />}
    </div>
  );
};
