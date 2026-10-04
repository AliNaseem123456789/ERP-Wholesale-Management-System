import React, { useEffect, useState } from "react";
import { Download, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { opsApi, downloadCsv } from "../api/ops.api";
import { Card, PageHeader, Spinner, Field, FilterTabs, StatusBadge, inputCls, inputBase, btnPrimary, btnSecondary } from "../components/ui";

const LABELS: Record<string, string> = {
  products: "Products", inventory: "Stock levels", customers: "Customers", orders: "Orders", order_lines: "Order lines", invoices: "Invoices",
  suppliers: "Suppliers", employees: "Employees", journal: "Journal (general ledger lines)",
};
const DATED = ["orders", "order_lines", "invoices", "journal"];
const IMPORT_HELP: Record<string, string> = {
  products: "Matched by SKU: existing SKUs are updated, new ones created. Separate flavours and categories with |.",
  inventory: "Sets on-hand stock to the counted quantity per warehouse (a stock count). Differences post to the books.",
  suppliers: "Matched by supplier name.",
  employees: "Existing employee numbers are updated; a blank number creates a new employee.",
  customers: "Adds marketplace users as your customers with terms, group and tobacco licence.",
};

const Exports: React.FC<{ types: { type: string; allowed: boolean }[] }> = ({ types }) => {
  const { companyId, company } = useBusiness();
  const [range, setRange] = useState({ from: "", to: "" });
  const [busy, setBusy] = useState("");
  const go = async (type: string) => {
    setBusy(type);
    try {
      const q = DATED.includes(type) ? `?${new URLSearchParams(Object.entries(range).filter(([, v]) => v))}` : "";
      await downloadCsv(companyId!, `/company/export/${type}${q}`, `${(company as any)?.slug || "company"}-${type}.csv`);
    } catch (err) {
      toast.error(errorMessage(err, "Export failed"));
    } finally {
      setBusy("");
    }
  };
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-end gap-3 mb-4 text-sm">
        <Field label="From (dated exports)"><input type="date" className={inputBase} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
        <Field label="To"><input type="date" className={inputBase} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
        <p className="text-gray-500 pb-2">Leave empty for everything. Files open in Excel, Google Sheets or Numbers.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {types.filter((t) => t.allowed).map((t) => (
          <button key={t.type} disabled={busy === t.type} onClick={() => go(t.type)} className="flex items-center gap-3 border border-gray-200 rounded-xl px-4 py-3 text-left hover:bg-gray-50 disabled:opacity-50">
            <FileSpreadsheet className="text-green-700 shrink-0" size={22} />
            <span className="flex-1"><span className="font-semibold text-gray-900 block">{LABELS[t.type] || t.type}</span>{DATED.includes(t.type) && <span className="text-xs text-gray-400">uses the dates above</span>}</span>
            <Download size={16} className="text-gray-400" />
          </button>
        ))}
      </div>
    </Card>
  );
};

const Imports: React.FC<{ types: { type: string; columns: string[]; required: string[]; note: string | null; allowed: boolean }[] }> = ({ types }) => {
  const { companyId } = useBusiness();
  const allowed = types.filter((t) => t.allowed);
  const [type, setType] = useState(allowed[0]?.type || "");
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const def = allowed.find((t) => t.type === type);
  useEffect(() => { setResult(null); }, [type, file]);
  if (!allowed.length) return <Card className="p-6 text-sm text-gray-500">You don't have permission to import anything.</Card>;
  const pick = (f?: File | null) => {
    if (!f) return setFile(null);
    if (f.size > 5 * 1024 * 1024) return toast.error("The file is too big (max 5 MB)");
    const reader = new FileReader();
    reader.onload = () => setFile({ name: f.name, text: String(reader.result || "") });
    reader.readAsText(f);
  };
  const run = async (dryRun: boolean) => {
    if (!file) return toast.error("Choose a CSV file first");
    setBusy(true);
    try {
      const r = await opsApi.importCsv(companyId!, type, file.text, dryRun);
      setResult(r);
      if (r.applied) toast.success(r.message);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="p-5 space-y-4 text-sm">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <Field label="What are you importing?">
          <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
            {allowed.map((t) => <option key={t.type} value={t.type}>{LABELS[t.type] || t.type}</option>)}
          </select>
        </Field>
        <Field label="CSV file"><input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={(e) => pick(e.target.files?.[0])} className="text-sm" /></Field>
        <button type="button" onClick={() => downloadCsv(companyId!, `/company/import/${type}/template`, `${type}-template.csv`).catch((e) => toast.error(errorMessage(e)))} className={btnSecondary}><Download size={16} /> Template</button>
      </div>
      <div className="bg-gray-50 rounded-xl px-4 py-3 text-gray-600">
        <p>{IMPORT_HELP[type]}</p>
        <p className="mt-1 text-xs">Columns: {def?.columns.map((c) => <code key={c} className={`mr-1 ${def.required.includes(c) ? "font-bold text-gray-900" : ""}`}>{c}</code>)} <span className="text-gray-400">(bold = required)</span></p>
      </div>
      <div className="flex gap-2">
        <button disabled={busy || !file} onClick={() => run(true)} className={btnSecondary}><CheckCircle2 size={16} /> Check file</button>
        <button disabled={busy || !file || !result || result.summary.errors > 0 || result.applied} onClick={() => run(false)} className={btnPrimary}><Upload size={16} /> Import</button>
        {file && <span className="self-center text-gray-500">{file.name}</span>}
      </div>
      {result && (
        <div className="space-y-3">
          <div className={`rounded-xl px-4 py-3 flex items-center gap-2 ${result.summary.errors ? "bg-red-50 text-red-800" : result.applied ? "bg-green-50 text-green-800" : "bg-blue-50 text-blue-900"}`}>
            {result.summary.errors ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
            <span className="font-semibold">{result.message}</span>
            <span className="ml-auto">{result.summary.rows} rows · {result.summary.create} new · {result.summary.update} updates{result.summary.skip ? ` · ${result.summary.skip} unchanged` : ""}{result.summary.errors ? ` · ${result.summary.errors} errors` : ""}</span>
          </div>
          {result.ignored_columns?.length > 0 && <p className="text-amber-700">Ignored columns: {result.ignored_columns.join(", ")}</p>}
          {result.errors.length > 0 && (
            <table className="w-full"><thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="py-1 w-16">Line</th><th>Problem</th></tr></thead>
              <tbody>{result.errors.map((e: any) => <tr key={e.line} className="border-b border-gray-50 text-red-700"><td className="py-1 font-mono">{e.line}</td><td>{e.message}</td></tr>)}</tbody></table>
          )}
          {result.errors.length === 0 && result.preview.length > 0 && (
            <table className="w-full"><thead><tr className="text-left text-[10px] uppercase text-gray-400 border-b"><th className="py-1 w-16">Line</th><th className="w-24">Action</th><th>Row</th></tr></thead>
              <tbody>{result.preview.map((p: any) => <tr key={p.line} className="border-b border-gray-50"><td className="py-1 font-mono">{p.line}</td><td><StatusBadge status={p.action === "create" ? "new" : p.action === "update" ? "updated" : "unchanged"} /></td><td>{p.label}</td></tr>)}</tbody></table>
          )}
        </div>
      )}
    </Card>
  );
};

export const DataPage: React.FC = () => {
  const { companyId } = useBusiness();
  const [tab, setTab] = useState("export");
  const [types, setTypes] = useState<any>(null);
  useEffect(() => { opsApi.dataTypes(companyId!).then(setTypes).catch((e) => toast.error(errorMessage(e))); }, [companyId]);
  return (
    <div>
      <PageHeader title="Import & export" subtitle="Move data in and out with CSV files" />
      <div className="mb-3"><FilterTabs value={tab} onChange={setTab} options={[{ value: "export", label: "Export" }, { value: "import", label: "Import" }]} /></div>
      {!types ? <Spinner /> : tab === "export" ? <Exports types={types.exports} /> : <Imports types={types.data} />}
    </div>
  );
};
