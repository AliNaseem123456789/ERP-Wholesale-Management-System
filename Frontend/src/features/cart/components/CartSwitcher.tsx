// Several named carts per buyer (e.g. one per store location or per supplier run). One is "active":
// products added anywhere on the site go into it, and checkout places it.
import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { ChevronDown, Plus, Pencil, Trash2, Check, MapPin } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "../../../api/apiClient";
import { AppDispatch, RootState } from "../../../app/store";
import { fetchCart, setActiveCart } from "../redux/cartSlice";

export type CartInfo = { id: string; name: string; is_default: boolean; address_id: string | null; notes: string | null; line_count: number; item_count: number };
const msg = (e: any) => e?.response?.data?.message || "Something went wrong";

export const cartsApi = {
  list: async () => (await apiClient.get("/cart/carts")).data.data as CartInfo[],
  create: async (body: { name: string; address_id?: string | null }) => (await apiClient.post("/cart/carts", body)).data as { data: CartInfo; message: string },
  update: async (id: string, body: Record<string, unknown>) => (await apiClient.patch(`/cart/carts/${id}`, body)).data as { message: string },
  remove: async (id: string) => (await apiClient.delete(`/cart/carts/${id}`)).data as { message: string },
  move: async (fromId: string, body: { to_cart_id: string; product_id?: number; flavor?: string | null }) => (await apiClient.post(`/cart/carts/${fromId}/move`, body)).data as { message: string },
};

export const useCarts = () => {
  const [carts, setCarts] = useState<CartInfo[]>([]);
  const items = useSelector((s: RootState) => s.cart.items);
  const reload = () => cartsApi.list().then((c) => setCarts(c.map((x) => ({ ...x, id: String(x.id), address_id: x.address_id ? String(x.address_id) : null })))).catch(() => {});
  useEffect(() => { reload(); }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return { carts, reload };
};

export const CartSwitcher: React.FC<{ carts: CartInfo[]; reload: () => void }> = ({ carts, reload }) => {
  const dispatch = useDispatch<AppDispatch>();
  const activeId = useSelector((s: RootState) => s.cart.cartId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CartInfo | null>(null);
  const [addresses, setAddresses] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    apiClient.get("/address").then((r) => setAddresses((r.data.data || []).map((a: any) => ({ id: String(a.id), label: [a.full_name, a.address_line1, a.city].filter(Boolean).join(", ") || `Address ${a.id}` })))).catch(() => {});
  }, []);
  const current = carts.find((c) => (activeId ? c.id === activeId : c.is_default)) || carts.find((c) => c.is_default);

  const switchTo = (c: CartInfo) => {
    const id = c.is_default ? null : c.id;
    dispatch(setActiveCart(id));
    dispatch(fetchCart(id));
    setOpen(false);
  };
  const create = async () => {
    const name = window.prompt("Name the new cart (e.g. “Downtown store” or “Monthly restock”)", "");
    if (!name?.trim()) return;
    try {
      const r = await cartsApi.create({ name: name.trim() });
      toast.success(`${r.message}. New items go into it.`);
      reload();
      switchTo({ ...r.data, id: String(r.data.id), is_default: false } as CartInfo);
    } catch (e) { toast.error(msg(e)); }
  };
  const remove = async (c: CartInfo) => {
    if (!window.confirm(c.is_default ? "Empty your main cart?" : `Delete the cart "${c.name}" and everything in it?`)) return;
    try {
      toast.success((await cartsApi.remove(c.id)).message);
      if (current?.id === c.id) switchTo(carts.find((x) => x.is_default)!);
      else dispatch(fetchCart(undefined));
      reload();
    } catch (e) { toast.error(msg(e)); }
  };
  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    try {
      await cartsApi.update(editing.id, { name: editing.name, address_id: editing.address_id || null, notes: editing.notes || null });
      toast.success("Cart saved");
      setEditing(null);
      reload();
    } catch (err) { toast.error(msg(err)); }
  };

  if (!current) return null;
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-900 hover:border-gray-400">
        <span className="text-gray-500 font-normal">Cart:</span> {current.name}
        {carts.length > 1 && <span className="text-xs text-gray-400">({carts.length} carts)</span>}
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="absolute z-40 mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-xl p-2 right-0 sm:left-0 sm:right-auto">
          {carts.map((c) => (
            <div key={c.id} className={`flex items-center gap-2 rounded-lg px-2 py-2 ${c.id === current.id ? "bg-blue-50" : "hover:bg-gray-50"}`}>
              <button onClick={() => switchTo(c)} className="flex-1 text-left min-w-0">
                <span className="flex items-center gap-1 font-semibold text-sm text-gray-900 truncate">{c.id === current.id && <Check size={14} className="text-blue-600" />}{c.name}</span>
                <span className="block text-xs text-gray-500">{c.item_count} units · {c.line_count} lines{c.address_id ? " · own address" : ""}</span>
              </button>
              <button onClick={() => { setEditing(c); setOpen(false); }} className="p-1.5 text-gray-400 hover:text-gray-800" aria-label={`Edit ${c.name}`}><Pencil size={14} /></button>
              <button onClick={() => remove(c)} className="p-1.5 text-gray-400 hover:text-red-600" aria-label={c.is_default ? "Empty main cart" : `Delete ${c.name}`}><Trash2 size={14} /></button>
            </div>
          ))}
          <button onClick={create} className="w-full mt-1 flex items-center gap-2 px-2 py-2 text-sm font-semibold text-blue-600 hover:bg-gray-50 rounded-lg"><Plus size={15} /> New cart</button>
        </div>
      )}
      {editing && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onMouseDown={() => setEditing(null)}>
          <form onSubmit={saveEdit} onMouseDown={(e) => e.stopPropagation()} className="bg-white text-gray-900 rounded-2xl p-6 w-full max-w-md space-y-4" role="dialog" aria-modal="true" aria-label="Edit cart">
            <h2 className="font-bold text-lg">Cart settings</h2>
            <label className="block text-sm font-semibold">Name
              <input required maxLength={120} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg bg-white" />
            </label>
            <label className="block text-sm font-semibold"><span className="flex items-center gap-1"><MapPin size={14} /> Deliver to</span>
              <select value={editing.address_id || ""} onChange={(e) => setEditing({ ...editing, address_id: e.target.value || null })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg bg-white">
                <option value="">Choose at checkout</option>
                {addresses.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </label>
            <label className="block text-sm font-semibold">Notes
              <textarea rows={2} maxLength={500} value={editing.notes || ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg bg-white" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg border border-gray-300 font-semibold text-sm">Cancel</button>
              <button className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm">Save</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
