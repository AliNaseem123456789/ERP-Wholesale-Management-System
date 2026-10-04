import React, { useCallback, useEffect, useState } from "react";
import { Building2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { adminService } from "../api/admin.service";
import { errorMessage } from "../../business/api/business.api";
import { Card, Field, Modal, StatusBadge, Spinner, inputCls, btnPrimary, btnSecondary, dateOnly, inputBase } from "../../business/components/ui";

export const CompaniesManagement: React.FC = () => {
  const [companies, setCompanies] = useState<any[] | null>(null);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", ownerEmail: "" });

  const load = useCallback(() => {
    adminService.getCompanies({ status, search }).then(setCompanies).catch((e) => toast.error(errorMessage(e)));
  }, [status, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load]);

  const setCompanyStatus = async (c: any, next: string) => {
    if (next === "suspended" && !window.confirm(`Suspend ${c.name}? Their products disappear from the store and staff lose access.`)) return;
    try {
      const res = await adminService.updateCompany(c.id, { status: next });
      toast.success(res.message);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const setCommission = async (c: any) => {
    const value = window.prompt(`Commission % for ${c.name} (reserved for future payouts)`, String(c.commission_rate ?? 0));
    if (value === null) return;
    try {
      await adminService.updateCompany(c.id, { commission_rate: Number(value) });
      toast.success("Commission saved");
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await adminService.createCompany({ name: form.name, ownerEmail: form.ownerEmail || undefined });
      toast.success(res.message);
      setCreating(false);
      setForm({ name: "", ownerEmail: "" });
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const pending = companies?.filter((c) => c.status === "pending").length || 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-black text-gray-900 flex-1">
          Companies {pending > 0 && <span className="ml-2 text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded-full align-middle">{pending} waiting for approval</span>}
        </h2>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input className={`${inputCls} pl-9 w-56`} placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className={`${inputBase} w-auto`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <button onClick={() => setCreating(true)} className={btnPrimary}><Plus size={16} /> New company</button>
      </div>

      <Card>
        {!companies ? (
          <Spinner />
        ) : companies.length === 0 ? (
          <p className="p-8 text-center text-gray-500">No companies.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50">
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Owners</th>
                  <th className="px-4 py-3 text-center">Products</th>
                  <th className="px-4 py-3 text-center">Orders</th>
                  <th className="px-4 py-3 text-center">Staff</th>
                  <th className="px-4 py-3">Commission</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {companies.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Building2 size={16} className="text-gray-400" />
                        <div>
                          <p className="font-semibold text-gray-900">{c.name}</p>
                          <p className="text-xs text-gray-400">/{c.slug} · since {dateOnly(c.created_at)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{c.owners.join(", ") || <span className="text-gray-400">invite pending</span>}</td>
                    <td className="px-4 py-3 text-center">{c.counts.products}</td>
                    <td className="px-4 py-3 text-center">{c.counts.orders}</td>
                    <td className="px-4 py-3 text-center">{c.counts.company_members}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => setCommission(c)} className="text-blue-600 hover:underline">{Number(c.commission_rate)}%</button>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {c.status !== "active" && (
                        <button onClick={() => setCompanyStatus(c, "active")} className="text-xs font-bold text-green-700 hover:underline mr-3">
                          {c.status === "pending" ? "Approve" : "Reactivate"}
                        </button>
                      )}
                      {c.status !== "suspended" && (
                        <button onClick={() => setCompanyStatus(c, "suspended")} className="text-xs font-bold text-red-600 hover:underline">Suspend</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating && (
        <Modal title="New company" onClose={() => setCreating(false)}>
          <form onSubmit={create} className="space-y-4">
            <Field label="Company name *">
              <input required className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Owner email" hint="We'll email them an invitation to set up their account as OWNER">
              <input type="email" className={inputCls} value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCreating(false)} className={btnSecondary}>Cancel</button>
              <button className={btnPrimary}>Create company</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
