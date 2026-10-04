import React, { useState } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { changePasswordApi } from "../../auth/api/auth.api";

const field =
  "w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none";

export const ChangePasswordCard: React.FC = () => {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.next.length < 8) return toast.error("New password must be at least 8 characters");
    if (form.next !== form.confirm) return toast.error("New passwords do not match");
    setSaving(true);
    try {
      const res = await changePasswordApi(form.current, form.next);
      toast.success(res.message);
      setForm({ current: "", next: "", confirm: "" });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-10 pt-8 border-t border-gray-100 space-y-4 max-w-2xl">
      <h3 className="font-bold text-gray-900 flex items-center gap-2">
        <KeyRound size={18} /> Change password
      </h3>
      <input type="password" required placeholder="Current password" className={field} value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <input type="password" required placeholder="New password (min. 8)" className={field} value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} />
        <input type="password" required placeholder="Confirm new password" className={field} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
      </div>
      <p className="text-xs text-gray-500">Changing your password signs you out on all other devices.</p>
      <button disabled={saving} className="bg-gray-900 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-black disabled:opacity-50">
        {saving ? "Updating..." : "Update password"}
      </button>
    </form>
  );
};
