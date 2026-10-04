import React, { useState } from "react";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../auth/context/AuthContext";
import { businessApi, errorMessage } from "../api/business.api";
import { setActiveCompanyId } from "../context/activeCompany";
import { Card, Field, inputCls, btnPrimary } from "../components/ui";

// Shown at /business for users who don't belong to any company yet.
export const RegisterBusinessPage: React.FC = () => {
  const { refreshUser } = useAuth();
  const [form, setForm] = useState({ name: "", email: "", phone: "", website: "", city: "", state: "", description: "" });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await businessApi.register(form);
      setActiveCompanyId(String(res.data.id));
      toast.success(res.message);
      await refreshUser();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="text-center mb-8">
        <Building2 className="mx-auto text-blue-600 mb-3" size={40} />
        <h1 className="text-3xl font-black text-gray-900">Sell on the marketplace</h1>
        <p className="text-gray-500 mt-2">
          Register your wholesale business to list products, receive orders and manage your team. If you were invited by a
          company, open the link in your invitation email instead.
        </p>
      </div>
      <Card className="p-6">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Business name *">
            <input required className={inputCls} value={form.name} onChange={set("name")} />
          </Field>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Business email" hint="Order notifications are also sent here">
              <input type="email" className={inputCls} value={form.email} onChange={set("email")} />
            </Field>
            <Field label="Phone">
              <input className={inputCls} value={form.phone} onChange={set("phone")} />
            </Field>
            <Field label="City">
              <input className={inputCls} value={form.city} onChange={set("city")} />
            </Field>
            <Field label="State">
              <input className={inputCls} value={form.state} onChange={set("state")} />
            </Field>
          </div>
          <Field label="Website">
            <input className={inputCls} value={form.website} onChange={set("website")} placeholder="https://" />
          </Field>
          <Field label="About your business">
            <textarea rows={3} className={inputCls} value={form.description} onChange={set("description")} />
          </Field>
          <button disabled={saving} className={`${btnPrimary} w-full justify-center py-3`}>
            {saving ? "Submitting..." : "Register business"}
          </button>
        </form>
      </Card>
    </div>
  );
};
