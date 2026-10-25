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

// Shown on the public store page (Phase 2 marketplace profile).
const STORE_FIELDS = [
  ["tagline", "Tagline", "One line under your name, e.g. “Wholesale cleaning supplies since 1998”"],
  ["public_email", "Public email", "Where buyers can reach you; leave empty to hide"],
  ["public_phone", "Public phone", "Leave empty to hide"],
  ["min_order_value", "Minimum order value", "Leave empty for no minimum"],
  ["lead_time_days", "Usual lead time (days)", "How long orders normally take to ship"],
] as const;
const STORE_TEXT = [
  ["delivery_info", "Delivery information", "Areas you deliver to, carriers, delivery charges"],
  ["payment_info", "Payment terms", "e.g. Net 30 for approved accounts, card, bank transfer"],
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
    [...STORE_FIELDS, ...STORE_TEXT].forEach(([k]) => (f[k] = company[k] == null ? "" : String(company[k])));
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

  const uploadBanner = async (file?: File) => {
    if (!file) return;
    try {
      await businessApi.uploadBanner(companyId!, file);
      toast.success("Banner updated");
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
          <fieldset disabled={!editable} className="pt-6 mt-2 border-t border-gray-100">
            <legend className="font-bold text-gray-900">Store page</legend>
            <p className="text-sm text-gray-500 mb-4">What buyers see on your public page. Design the page itself in <Link to="/business/storefront" className="text-blue-600 hover:underline">Storefront</Link>.</p>
            <div className="mb-4">
              <p className="text-sm font-semibold text-gray-700 mb-1">Banner</p>
              <div className="relative aspect-[16/4] rounded-xl bg-gray-100 overflow-hidden flex items-center justify-center text-sm text-gray-400">
                {company.banner_url ? <img src={company.banner_url} alt="Store banner" className="absolute inset-0 w-full h-full object-cover" /> : "No banner yet (wide image, about 1600×400)"}
              </div>
              {editable && (
                <label className="inline-block mt-2 text-sm font-semibold text-blue-600 cursor-pointer hover:underline">
                  {company.banner_url ? "Change banner" : "Upload banner"}
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => uploadBanner(e.target.files?.[0])} />
                </label>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {STORE_FIELDS.map(([k, label, hint]) => (
                <Field key={k} label={label}>
                  <input className={inputCls} value={form[k] || ""} placeholder={hint}
                    type={k === "public_email" ? "email" : k === "min_order_value" || k === "lead_time_days" ? "number" : "text"}
                    min={k === "min_order_value" || k === "lead_time_days" ? 0 : undefined} step={k === "min_order_value" ? "0.01" : undefined}
                    onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                </Field>
              ))}
              {STORE_TEXT.map(([k, label, hint]) => (
                <div key={k} className="md:col-span-2">
                  <Field label={label}>
                    <textarea rows={3} className={inputCls} value={form[k] || ""} placeholder={hint} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                  </Field>
                </div>
              ))}
            </div>
            {company.storefront_published === false && <p className="mt-3 text-sm text-amber-600">Your store page is hidden from the marketplace. Publish it from Storefront.</p>}
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
