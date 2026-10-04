import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { salesApi, CustomerGroup, customerName, paymentLabel } from "../api/sales.api";
import { Card, PageHeader, Spinner, EmptyState, StatusBadge, Modal, Field, Stat, money, dateOnly, inputCls, inputBase, btnPrimary, btnSecondary } from "../components/ui";

const CustomerDetail: React.FC<{ id: number; groups: CustomerGroup[]; onClose: () => void; onSaved: () => void }> = ({ id, groups, onClose, onSaved }) => {
  const { companyId, can } = useBusiness();
  const canManage = can("customers.manage");
  const [c, setC] = useState<any>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    salesApi
      .customer(companyId!, id)
      .then((d) => {
        setC(d);
        setForm({
          customer_group_id: d.customer_group_id ? String(d.customer_group_id) : "",
          payment_terms_days: String(d.payment_terms_days ?? 0),
          credit_limit: d.credit_limit == null ? "" : String(d.credit_limit),
          status: d.status,
          tax_exempt: !!d.tax_exempt,
          tax_id: d.tax_id || "",
          notes: d.notes || "",
        });
      })
      .catch((e) => toast.error(errorMessage(e)));
  }, [companyId, id]);
  useEffect(load, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await salesApi.updateCustomer(companyId!, id, {
        ...form,
        customer_group_id: form.customer_group_id || null,
        payment_terms_days: Number(form.payment_terms_days || 0),
        credit_limit: form.credit_limit === "" ? null : Number(form.credit_limit),
      });
      toast.success(res.message);
      onSaved();
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={c ? customerName(c.user) : "Customer"} onClose={onClose} wide>
      {!c ? <Spinner /> : (
        <div className="space-y-6 text-sm">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Outstanding" value={money(c.outstanding)} tone={c.outstanding > 0 ? "warn" : "default"} />
            <Stat label="Credit limit" value={c.credit_limit == null ? "None" : money(c.credit_limit)} />
            <Stat label="Credit available" value={c.credit_available == null ? "—" : money(c.credit_available)} tone={c.credit_available != null && c.credit_available <= 0 ? "warn" : "good"} />
            <Stat label="Terms" value={c.payment_terms_days > 0 ? `Net ${c.payment_terms_days}` : "Pay on delivery"} />
          </div>
          <p className="text-gray-600">{c.user?.email}{c.user?.phone ? ` · ${c.user.phone}` : ""} · customer since {dateOnly(c.created_at)}</p>

          <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-gray-50 rounded-xl p-4">
            <Field label="Customer group">
              <select disabled={!canManage} className={inputCls} value={form.customer_group_id} onChange={(e) => setForm({ ...form, customer_group_id: e.target.value })}>
                <option value="">No group (standard prices)</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}{g.discount_percent ? ` (-${g.discount_percent}%)` : ""}</option>)}
              </select>
            </Field>
            <Field label="Payment terms (days)" hint="0 = pay on delivery only">
              <input disabled={!canManage} type="number" min={0} max={365} className={inputCls} value={form.payment_terms_days} onChange={(e) => setForm({ ...form, payment_terms_days: e.target.value })} />
            </Field>
            <Field label="Credit limit" hint="Empty = can't buy on account">
              <input disabled={!canManage} type="number" min={0} step="0.01" className={inputCls} value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} />
            </Field>
            <Field label="Account status">
              <select disabled={!canManage} className={inputCls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="blocked">On hold (can't order)</option>
              </select>
            </Field>
            <Field label="Tax ID / resale certificate">
              <input disabled={!canManage} className={inputCls} value={form.tax_id} onChange={(e) => setForm({ ...form, tax_id: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 mt-6 text-sm">
              <input disabled={!canManage} type="checkbox" checked={form.tax_exempt} onChange={(e) => setForm({ ...form, tax_exempt: e.target.checked })} /> Tax exempt
            </label>
            <div className="md:col-span-3">
              <Field label="Notes (internal)">
                <textarea disabled={!canManage} rows={2} className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </Field>
            </div>
            {canManage && <div className="md:col-span-3 flex justify-end"><button disabled={saving} className={btnPrimary}>{saving ? "Saving..." : "Save account"}</button></div>}
          </form>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-bold mb-2">Recent orders</h3>
              {c.orders.length === 0 ? <p className="text-gray-500">None yet.</p> : (
                <ul className="divide-y divide-gray-100">{c.orders.map((o: any) => (
                  <li key={o.id} className="py-2 flex items-center gap-2">
                    <Link to={`/business/orders?open=${o.id}`} className="font-mono font-bold text-blue-600">{o.order_number}</Link>
                    <StatusBadge status={o.status} />
                    <span className="text-xs text-gray-500">{paymentLabel(o.payment_method)}</span>
                    <span className="ml-auto font-bold">{money(o.total_amount)}</span>
                  </li>
                ))}</ul>
              )}
            </div>
            <div>
              <h3 className="font-bold mb-2">Invoices</h3>
              {c.invoices.length === 0 ? <p className="text-gray-500">None yet.</p> : (
                <ul className="divide-y divide-gray-100">{c.invoices.map((i: any) => (
                  <li key={i.id} className="py-2 flex items-center gap-2">
                    <Link to={`/business/invoices?open=${i.id}`} className="font-mono font-bold text-blue-600">{i.invoice_number}</Link>
                    <StatusBadge status={i.status} />
                    <span className="text-xs text-gray-500">due {dateOnly(i.due_date)}</span>
                    <span className="ml-auto font-bold">{i.status === "void" ? "—" : money(i.balance)}</span>
                  </li>
                ))}</ul>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};

export const CustomersPage: React.FC = () => {
  const { companyId, can } = useBusiness();
  const [list, setList] = useState<any[] | null>(null);
  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  const [search, setSearch] = useState("");
  const [groupId, setGroupId] = useState("");
  const [viewing, setViewing] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");

  const load = useCallback(() => {
    salesApi.customers(companyId!, { search, group_id: groupId }).then(setList).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, search, groupId]);
  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    salesApi.groups(companyId!).then(setGroups).catch(() => {});
  }, [companyId]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await salesApi.addCustomer(companyId!, email);
      toast.success(res.message);
      setAdding(false);
      setEmail("");
      load();
      setViewing(res.data.id);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Buyers with an account at your business: groups, payment terms, credit limits"
        actions={can("customers.manage") && <button onClick={() => setAdding(true)} className={btnPrimary}><Plus size={16} /> Add customer</button>}
      />
      <Card>
        <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input className={`${inputCls} pl-9`} placeholder="Search name, business or email" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className={inputBase} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">All groups</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        {!list ? <Spinner /> : list.length === 0 ? (
          <EmptyState icon={<UserRound size={40} />} title="No customers yet" text="Customers appear here after their first order, or add one by email to set terms first." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50"><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Group</th><th className="px-4 py-3">Terms</th><th className="px-4 py-3 text-right">Orders</th><th className="px-4 py-3 text-right">Spent</th><th className="px-4 py-3 text-right">Balance</th><th className="px-4 py-3">Status</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {list.map((c) => (
                  <tr key={c.id} className="hover:bg-blue-50/40 cursor-pointer" onClick={() => setViewing(c.id)}>
                    <td className="px-4 py-3"><p className="font-semibold text-gray-900">{customerName(c.user)}</p><p className="text-xs text-gray-500">{c.user?.email}</p></td>
                    <td className="px-4 py-3">{c.group?.name || <span className="text-gray-400">—</span>}</td>
                    <td className="px-4 py-3">{c.payment_terms_days > 0 ? `Net ${c.payment_terms_days}${c.credit_limit != null ? ` · limit ${money(c.credit_limit)}` : ""}` : "On delivery"}</td>
                    <td className="px-4 py-3 text-right">{c.orders}</td>
                    <td className="px-4 py-3 text-right">{money(c.spent)}</td>
                    <td className="px-4 py-3 text-right">
                      {c.balance > 0 ? <span className={c.overdue > 0 ? "font-bold text-red-600" : "font-semibold"}>{money(c.balance)}</span> : "—"}
                      {c.overdue > 0 && <p className="text-[10px] text-red-600 font-bold">{money(c.overdue)} overdue</p>}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {adding && (
        <Modal title="Add a customer" onClose={() => setAdding(false)}>
          <form onSubmit={add} className="space-y-4">
            <p className="text-sm text-gray-600">The buyer must already have a marketplace account. Adding them lets you set a group, terms and a credit limit before their first order.</p>
            <Field label="Customer email"><input type="email" required className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setAdding(false)} className={btnSecondary}>Cancel</button><button className={btnPrimary}>Add</button></div>
          </form>
        </Modal>
      )}
      {viewing && <CustomerDetail id={viewing} groups={groups} onClose={() => setViewing(null)} onSaved={load} />}
    </div>
  );
};
