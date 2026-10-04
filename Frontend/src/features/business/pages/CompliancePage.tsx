import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Pencil, Trash2, ShieldCheck, Download, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { opsApi, downloadCsv, COMPLIANCE_CATEGORIES, TAX_TYPE_LABELS } from "../api/ops.api";
import { Card, PageHeader, Spinner, EmptyState, StatusBadge, Modal, Field, FilterTabs, money, dateOnly, inputCls, inputBase, btnPrimary, btnSecondary } from "../components/ui";

const FLAGS: [string, string][] = [
  ["flavor_ban", "Flavored products banned"], ["license_required", "Customer needs a tobacco licence on file"], ["ship_banned", "Can't ship here"],
  ["age_verification", "Adult signature / age check (21+) on delivery"], ["report_shipments", "Include in the state shipment report (e.g. PACT Act)"],
];
const today = () => new Date().toISOString().slice(0, 10);
const rateText = (r: any) => (r.tax_type === "percent" ? `${Number(r.tax_rate)}%` : r.tax_type === "per_ml" ? `${money(r.tax_rate)}/ml` : r.tax_type === "per_unit" ? `${money(r.tax_rate)}/unit` : "—");

const RuleModal: React.FC<{ rule: any; states: Record<string, string>; onClose: () => void; onSaved: () => void }> = ({ rule, states, onClose, onSaved }) => {
  const { companyId } = useBusiness();
  const [f, setF] = useState({ state: "", category: "*", tax_type: "none", flavor_ban: false, license_required: false, ship_banned: false, age_verification: false, report_shipments: false, notes: "", ...rule, tax_rate: rule?.tax_rate != null ? String(rule.tax_rate) : "" });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const body = { ...f, tax_rate: Number(f.tax_rate || 0) };
      const r = rule?.id ? await opsApi.updateRule(companyId!, rule.id, body) : await opsApi.saveRule(companyId!, body);
      toast.success(r.message);
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Modal title={rule?.id ? `${states[rule.state]}: ${rule.category === "*" ? "all regulated products" : COMPLIANCE_CATEGORIES[rule.category]}` : "New state rule"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-sm">
        {!rule?.id && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="State">
              <select required className={inputCls} value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}>
                <option value="">Choose a state</option>
                {Object.entries(states).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Products">
              <select className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                <option value="*">All regulated products</option>
                {Object.entries(COMPLIANCE_CATEGORIES).filter(([k]) => k !== "none").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Excise tax">
            <select className={inputCls} value={f.tax_type} onChange={(e) => setF({ ...f, tax_type: e.target.value })}>
              {Object.entries(TAX_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          {f.tax_type !== "none" && <Field label={f.tax_type === "percent" ? "Rate (%)" : "Rate ($)"}><input type="number" min="0" step="0.0001" required className={inputCls} value={f.tax_rate} onChange={(e) => setF({ ...f, tax_rate: e.target.value })} /></Field>}
        </div>
        {FLAGS.map(([k, label]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={!!(f as any)[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> {label}</label>)}
        <Field label="Notes (law reference, effective date...)"><input className={inputCls} value={f.notes || ""} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <p className="text-xs text-gray-500">You set these rules yourself: check current state law. A rule for a specific product category overrides the "all regulated products" rule for that state.</p>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={btnSecondary}>Cancel</button><button className={btnPrimary}>Save rule</button></div>
      </form>
    </Modal>
  );
};

const Rules: React.FC = () => {
  const { companyId, can } = useBusiness();
  const [d, setD] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null);
  const load = useCallback(() => { opsApi.compliance(companyId!).then(setD).catch((e) => toast.error(errorMessage(e))); }, [companyId]);
  useEffect(load, [load]);
  if (!d) return <Spinner />;
  const manage = can("sales.manage");
  const regulated = Object.entries(d.products as Record<string, number>).filter(([k]) => k !== "none").reduce((s, [, v]) => s + v, 0);
  return (
    <div className="space-y-3">
      <Card className="p-4 text-sm flex flex-wrap gap-6 items-center">
        <span><b>{regulated}</b> regulated product(s) · <b>{d.products.none || 0}</b> not regulated</span>
        {d.missing_ml > 0 && <span className="text-amber-700 flex items-center gap-1"><AlertTriangle size={14} /> {d.missing_ml} vapor/e-liquid product(s) have no ml volume (per-ml taxes count 0)</span>}
        <span className="text-gray-500">Set each product's category on the Products page.</span>
        {manage && <button onClick={() => setEdit({})} className={`${btnPrimary} ml-auto`}><Plus size={16} /> State rule</button>}
      </Card>
      <Card className="overflow-x-auto">
        {d.rules.length === 0 ? <EmptyState icon={<ShieldCheck size={36} />} title="No state rules yet" text="Add the states you ship to: excise tax, flavour bans, licence requirements and shipping bans are applied at checkout." /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">State</th><th>Products</th><th>Excise</th><th>Rules</th><th className="w-16" /></tr></thead>
            <tbody>{d.rules.map((r: any) => (
              <tr key={r.id} className="border-b border-gray-50">
                <td className="px-4 py-2 font-semibold">{d.states[r.state]} <span className="text-gray-400 font-mono">{r.state}</span></td>
                <td>{r.category === "*" ? "All regulated" : COMPLIANCE_CATEGORIES[r.category]}</td>
                <td>{rateText(r)}</td>
                <td className="text-xs">{FLAGS.filter(([k]) => r[k]).map(([k, l]) => <span key={k} className={`inline-block mr-1 mb-1 px-2 py-0.5 rounded-full ${k === "ship_banned" || k === "flavor_ban" ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-700"}`}>{l}</span>)}{r.notes && <span className="block text-gray-400">{r.notes}</span>}</td>
                <td className="pr-4 text-right whitespace-nowrap">{manage && <>
                  <button onClick={() => setEdit(r)} className="text-gray-400 hover:text-blue-700 mr-2" aria-label={`Edit ${r.state} rule`}><Pencil size={14} /></button>
                  <button onClick={() => window.confirm("Remove this rule?") && opsApi.deleteRule(companyId!, r.id).then((x) => { toast.success(x.message); load(); })} className="text-gray-400 hover:text-red-600" aria-label={`Delete ${r.state} rule`}><Trash2 size={14} /></button>
                </>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      {edit && <RuleModal rule={edit} states={d.states} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
};

const Licenses: React.FC = () => {
  const { companyId, can } = useBusiness();
  const [rows, setRows] = useState<any[] | null>(null);
  const [states, setStates] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<any>(null);
  const load = useCallback(() => { opsApi.licenses(companyId!).then(setRows).catch((e) => toast.error(errorMessage(e))); }, [companyId]);
  useEffect(() => { load(); opsApi.compliance(companyId!).then((d) => setStates(d.states)).catch(() => {}); }, [load]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      toast.success((await opsApi.saveLicense(companyId!, adding)).message);
      setAdding(null);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <div className="space-y-3">
      {can("customers.manage") && <div className="flex justify-end"><button onClick={() => setAdding({ email: "", state: "", license_number: "", expires_on: "" })} className={btnPrimary}><Plus size={16} /> Customer licence</button></div>}
      <Card className="overflow-hidden">
        {!rows ? <Spinner /> : rows.length === 0 ? <EmptyState title="No customer licences yet" text="States that require a licence block checkout until one is on file." /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">Customer</th><th>State</th><th>Licence</th><th>Expires</th><th>Status</th><th className="w-10" /></tr></thead>
            <tbody>{rows.map((l) => (
              <tr key={l.id} className="border-b border-gray-50">
                <td className="px-4 py-2"><span className="font-semibold">{l.customer?.business_name || l.customer?.email}</span>{l.customer?.business_name && <span className="block text-xs text-gray-400">{l.customer.email}</span>}</td>
                <td>{l.state_name}</td><td className="font-mono">{l.license_number}</td><td>{l.expires_on ? dateOnly(l.expires_on) : "—"}</td>
                <td><StatusBadge status={l.status === "valid" ? "active" : l.status === "expiring" ? "low" : "expired"} /></td>
                <td>{can("customers.manage") && <button onClick={() => window.confirm("Remove this licence?") && opsApi.deleteLicense(companyId!, l.id).then(load)} className="text-gray-400 hover:text-red-600" aria-label="Remove licence"><Trash2 size={14} /></button>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      {adding && (
        <Modal title="Customer tobacco licence" onClose={() => setAdding(null)}>
          <form onSubmit={save} className="space-y-3 text-sm">
            <Field label="Customer email"><input type="email" required className={inputCls} value={adding.email} onChange={(e) => setAdding({ ...adding, email: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="State">
                <select required className={inputCls} value={adding.state} onChange={(e) => setAdding({ ...adding, state: e.target.value })}>
                  <option value="">Choose</option>
                  {Object.entries(states).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Expires"><input type="date" className={inputCls} value={adding.expires_on} onChange={(e) => setAdding({ ...adding, expires_on: e.target.value })} /></Field>
            </div>
            <Field label="Licence number"><input required className={inputCls} value={adding.license_number} onChange={(e) => setAdding({ ...adding, license_number: e.target.value })} /></Field>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setAdding(null)} className={btnSecondary}>Cancel</button><button className={btnPrimary}>Save</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
};

const Reports: React.FC = () => {
  const { companyId } = useBusiness();
  const [range, setRange] = useState({ from: `${today().slice(0, 7)}-01`, to: today() });
  const [excise, setExcise] = useState<any>(null);
  useEffect(() => { opsApi.runReport(companyId!, "excise_by_state", range).then(setExcise).catch((e) => toast.error(errorMessage(e))); }, [companyId, range]);
  const dl = (key: string, extra = "") => downloadCsv(companyId!, `/company/reports/run/${key}?from=${range.from}&to=${range.to}&format=csv${extra}`, `${key}-${range.from}-${range.to}.csv`).catch((e) => toast.error(errorMessage(e)));
  return (
    <div className="space-y-3">
      <Card className="p-3 flex flex-wrap items-center gap-2 text-sm">
        <input type="date" aria-label="From" className={inputBase} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <span className="text-gray-400">to</span>
        <input type="date" aria-label="To" className={inputBase} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        <span className="flex-1" />
        <button onClick={() => dl("excise_by_state")} className={btnSecondary}><Download size={16} /> Excise CSV</button>
        <button onClick={() => dl("state_shipments", "&reportable=1")} className={btnSecondary}><Download size={16} /> Shipment report CSV</button>
      </Card>
      <Card className="overflow-hidden">
        <p className="font-bold px-4 pt-4">Excise tax collected (by invoice date)</p>
        {!excise ? <Spinner /> : excise.rows.length === 0 ? <p className="px-4 py-6 text-sm text-gray-500">No excise in this period.</p> : (
          <table className="w-full text-sm mt-2">
            <thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="px-4 py-2">State</th><th>Products</th><th className="text-right">Invoices</th><th className="text-right px-4">Excise</th></tr></thead>
            <tbody>{excise.rows.map((r: any) => <tr key={r.state + r.category} className="border-b border-gray-50"><td className="px-4 py-2 font-semibold">{r.state}</td><td>{COMPLIANCE_CATEGORIES[r.category] || r.category}</td><td className="text-right">{r.invoices}</td><td className="text-right px-4 font-mono">{money(r.excise)}</td></tr>)}</tbody>
          </table>
        )}
      </Card>
      <p className="text-xs text-gray-500">The shipment report lists every regulated product shipped into states where the rule says "include in the state shipment report", with the customer's address and licence: the information PACT Act-style monthly reports ask for.</p>
    </div>
  );
};

export const CompliancePage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "rules";
  return (
    <div>
      <PageHeader title="Tobacco compliance" subtitle="State excise taxes, flavour bans, licences and shipping rules, applied at checkout" />
      <div className="mb-3"><FilterTabs value={tab} onChange={(v) => setParams({ tab: v })} options={[{ value: "rules", label: "State rules" }, { value: "licenses", label: "Customer licences" }, { value: "reports", label: "Excise & shipment reports" }]} /></div>
      {tab === "rules" && <Rules />}
      {tab === "licenses" && <Licenses />}
      {tab === "reports" && <Reports />}
    </div>
  );
};
