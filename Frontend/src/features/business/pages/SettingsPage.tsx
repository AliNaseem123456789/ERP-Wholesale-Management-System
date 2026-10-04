import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { businessApi, errorMessage } from "../api/business.api";
import { Card, PageHeader, Field, StatusBadge, inputCls, btnPrimary } from "../components/ui";

const FIELDS = [
  ["name", "Business name"], ["legal_name", "Legal name"], ["email", "Business email"], ["phone", "Phone"],
  ["website", "Website"], ["tax_id", "Tax ID / EIN"], ["address_line1", "Address"], ["address_line2", "Address line 2"],
  ["city", "City"], ["state", "State"], ["postal_code", "ZIP / Postal code"], ["country", "Country"],
] as const;

export const SettingsPage: React.FC = () => {
  const { companyId, company, can, reloadCompany } = useBusiness();
  const editable = can("company.manage");
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!company) return;
    const f: Record<string, string> = { description: company.description || "" };
    FIELDS.forEach(([k]) => (f[k] = company[k] || ""));
    setForm(f);
  }, [company]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await businessApi.updateProfile(companyId!, form);
      toast.success(res.message);
      await reloadCompany();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file?: File) => {
    if (!file) return;
    try {
      await businessApi.uploadLogo(companyId!, file);
      toast.success("Logo updated");
      await reloadCompany();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  if (!company) return null;

  return (
    <div>
      <PageHeader
        title="Business settings"
        subtitle="Shown to customers on your store page and on emails"
        actions={
          company.status === "active" && (
            <Link to={`/companies/${company.slug}`} className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:underline">
              View public page <ExternalLink size={14} />
            </Link>
          )
        }
      />
      <Card className="p-6">
        <div className="flex items-center gap-4 mb-6 pb-6 border-b border-gray-100">
          <div className="w-16 h-16 rounded-xl bg-gray-100 overflow-hidden flex items-center justify-center text-2xl font-black text-gray-400">
            {company.logo_url ? <img src={company.logo_url} alt="" className="w-full h-full object-cover" /> : company.name[0]}
          </div>
          <div className="flex-1">
            <p className="font-bold text-gray-900">{company.name}</p>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <StatusBadge status={company.status} /> <span>/{company.slug}</span>
            </div>
          </div>
          {editable && (
            <label className="text-sm font-semibold text-blue-600 cursor-pointer hover:underline">
              Change logo
              <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadLogo(e.target.files?.[0])} />
            </label>
          )}
        </div>
        <form onSubmit={save} className="space-y-4">
          <fieldset disabled={!editable} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {FIELDS.map(([k, label]) => (
              <Field key={k} label={label}>
                <input className={inputCls} value={form[k] || ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} required={k === "name"} />
              </Field>
            ))}
            <div className="md:col-span-2">
              <Field label="About your business">
                <textarea rows={4} className={inputCls} value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </Field>
            </div>
          </fieldset>
          {editable ? (
            <button disabled={saving} className={btnPrimary}>{saving ? "Saving..." : "Save changes"}</button>
          ) : (
            <p className="text-sm text-gray-500">Only owners can change these settings.</p>
          )}
        </form>
      </Card>
    </div>
  );
};
