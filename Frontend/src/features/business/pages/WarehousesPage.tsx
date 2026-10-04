import React, { useCallback, useEffect, useState } from "react";
import { Warehouse as WarehouseIcon, Plus, Star, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { supplyApi, Warehouse, Bin } from "../api/supply.api";
import { Card, PageHeader, Spinner, StatusBadge, Modal, Field, inputCls, btnPrimary, btnSecondary } from "../components/ui";

const FIELDS: [keyof Warehouse, string][] = [
  ["name", "Name *"], ["code", "Code *"], ["address_line1", "Address"], ["city", "City"], ["state", "State"], ["postal_code", "ZIP"], ["phone", "Phone"],
];

const WarehouseForm: React.FC<{ warehouse: Warehouse | null; onClose: () => void; onSaved: () => void }> = ({ warehouse, onClose, onSaved }) => {
  const { companyId } = useBusiness();
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(FIELDS.map(([k]) => [k, String((warehouse as any)?.[k] ?? "")])),
  );
  const [saving, setSaving] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = warehouse ? await supplyApi.updateWarehouse(companyId!, warehouse.id, form) : await supplyApi.createWarehouse(companyId!, form);
      toast.success(res.message);
      onSaved();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title={warehouse ? `Edit ${warehouse.name}` : "New warehouse"} onClose={onClose}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3">
        {FIELDS.map(([k, label]) => (
          <Field key={k} label={label}>
            <input className={inputCls} required={label.endsWith("*")} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} placeholder={k === "code" ? "e.g. EAST" : undefined} />
          </Field>
        ))}
        <div className="col-span-2 flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button disabled={saving} className={btnPrimary}>{saving ? "Saving..." : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
};

const Bins: React.FC<{ warehouse: Warehouse; canManage: boolean }> = ({ warehouse, canManage }) => {
  const { companyId } = useBusiness();
  const [bins, setBins] = useState<Bin[] | null>(null);
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const load = () => supplyApi.bins(companyId!, warehouse.id).then(setBins).catch(() => setBins([]));
  useEffect(() => {
    load();
  }, [warehouse.id]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await supplyApi.createBin(companyId!, warehouse.id, { code, description });
      setCode("");
      setDescription("");
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const toggle = async (b: Bin) => {
    try {
      await supplyApi.updateBin(companyId!, b.id, { is_active: !b.is_active });
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  if (!bins) return <Spinner />;
  return (
    <div className="bg-gray-50 px-6 py-4 space-y-3">
      {bins.length === 0 ? <p className="text-sm text-gray-500">No bins yet. Bins are optional shelf/aisle locations used on pick lists.</p> : (
        <div className="flex flex-wrap gap-2">
          {bins.map((b) => (
            <span key={b.id} className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-sm ${b.is_active ? "bg-white border-gray-200" : "bg-gray-100 border-gray-200 text-gray-400 line-through"}`} title={b.description || ""}>
              {b.code}
              {canManage && <button onClick={() => toggle(b)} className="text-xs text-gray-400 hover:text-gray-700">{b.is_active ? "disable" : "enable"}</button>}
            </span>
          ))}
        </div>
      )}
      {canManage && (
        <form onSubmit={add} className="flex flex-wrap gap-2">
          <input required className={`${inputCls} max-w-[140px]`} placeholder="Bin code, e.g. A-01" value={code} onChange={(e) => setCode(e.target.value)} />
          <input className={`${inputCls} max-w-xs`} placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          <button className={btnSecondary}>Add bin</button>
        </form>
      )}
    </div>
  );
};

export const WarehousesPage: React.FC = () => {
  const { companyId, can } = useBusiness();
  const canManage = can("inventory.manage");
  const [list, setList] = useState<Warehouse[] | null>(null);
  const [editing, setEditing] = useState<Warehouse | null | undefined>(undefined);
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(() => {
    supplyApi.warehouses(companyId!).then(setList).catch((e) => toast.error(errorMessage(e)));
  }, [companyId]);
  useEffect(load, [load]);

  const update = async (w: Warehouse, body: Partial<Warehouse>) => {
    try {
      const res = await supplyApi.updateWarehouse(companyId!, w.id, body);
      toast.success(res.message);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div>
      <PageHeader title="Warehouses" subtitle="Where your stock is kept" actions={canManage && <button onClick={() => setEditing(null)} className={btnPrimary}><Plus size={16} /> New warehouse</button>} />
      <Card>
        {!list ? <Spinner /> : (
          <ul className="divide-y divide-gray-100">
            {list.map((w) => (
              <li key={w.id}>
                <div className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <button onClick={() => setOpen(open === w.id ? null : w.id)} className="text-gray-400" aria-label="Show bins">
                    {open === w.id ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  </button>
                  <WarehouseIcon size={20} className="text-gray-400" />
                  <div className="flex-1 min-w-[180px]">
                    <p className="font-bold text-gray-900">
                      {w.name} <span className="text-gray-400 font-normal">({w.code})</span>
                      {w.is_default && <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full"><Star size={10} /> default</span>}
                    </p>
                    <p className="text-xs text-gray-500">{[w.address_line1, w.city, w.state, w.postal_code].filter(Boolean).join(", ") || "No address"}</p>
                  </div>
                  <span className="text-sm text-gray-600">{w.units} units{w.reserved ? ` · ${w.reserved} reserved` : ""} · {w.binCount} bins</span>
                  <StatusBadge status={w.is_active ? "active" : "inactive"} />
                  {canManage && (
                    <div className="flex gap-3 text-xs font-bold">
                      <button onClick={() => setEditing(w)} className="text-blue-600 hover:underline">Edit</button>
                      {!w.is_default && w.is_active && <button onClick={() => update(w, { is_default: true })} className="text-gray-600 hover:underline">Make default</button>}
                      {!w.is_default && (
                        <button onClick={() => update(w, { is_active: !w.is_active })} className={w.is_active ? "text-red-600 hover:underline" : "text-green-700 hover:underline"}>
                          {w.is_active ? "Deactivate" : "Activate"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {open === w.id && <Bins warehouse={w} canManage={canManage} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing !== undefined && <WarehouseForm warehouse={editing} onClose={() => setEditing(undefined)} onSaved={load} />}
    </div>
  );
};
