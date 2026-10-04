import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { salesApi } from "../api/sales.api";
import { Card, PageHeader, Spinner, Field, inputCls, btnPrimary } from "../components/ui";

export const SalesSettingsPage: React.FC = () => {
  const { companyId, can } = useBusiness();
  const canEdit = can("sales.manage");
  const [form, setForm] = useState<Record<string, any> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    salesApi.settings(companyId!).then((s) =>
      setForm({
        taxRate: String(s.taxRate),
        shippingFee: s.shippingFee == null ? "" : String(s.shippingFee),
        freeShippingOver: s.freeShippingOver == null ? "" : String(s.freeShippingOver),
        autoInvoice: s.autoInvoice,
        allowCashOnDelivery: s.allowCashOnDelivery,
        invoiceNotes: s.invoiceNotes || "",
        quoteValidityDays: String(s.quoteValidityDays),
        returnWindowDays: String(s.returnWindowDays),
      }),
    ).catch((e) => toast.error(errorMessage(e)));
  }, [companyId]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await salesApi.saveSettings(companyId!, {
        ...form,
        taxRate: Number(form!.taxRate || 0),
        shippingFee: form!.shippingFee === "" ? null : Number(form!.shippingFee),
        freeShippingOver: form!.freeShippingOver === "" ? null : Number(form!.freeShippingOver),
        quoteValidityDays: Number(form!.quoteValidityDays || 14),
        returnWindowDays: Number(form!.returnWindowDays || 0),
      } as any);
      toast.success(res.message);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (!form) return <Spinner />;
  const set = (k: string, v: any) => setForm({ ...form, [k]: v });
  return (
    <div>
      <PageHeader title="Sales settings" subtitle="Tax, shipping, invoicing, quotes and returns for your store" />
      <form onSubmit={save} className="space-y-4 max-w-3xl">
        <Card className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <h2 className="md:col-span-3 font-bold">Checkout</h2>
          <Field label="Sales tax %" hint="On the order after discounts; 0 = no tax"><input disabled={!canEdit} type="number" min={0} max={50} step="0.001" className={inputCls} value={form.taxRate} onChange={(e) => set("taxRate", e.target.value)} /></Field>
          <Field label="Shipping fee per order" hint="Empty = platform default"><input disabled={!canEdit} type="number" min={0} step="0.01" className={inputCls} value={form.shippingFee} onChange={(e) => set("shippingFee", e.target.value)} /></Field>
          <Field label="Free shipping over" hint="Empty = never free"><input disabled={!canEdit} type="number" min={0} step="0.01" className={inputCls} value={form.freeShippingOver} onChange={(e) => set("freeShippingOver", e.target.value)} /></Field>
          <label className="md:col-span-3 flex items-center gap-2 text-sm"><input disabled={!canEdit} type="checkbox" checked={form.allowCashOnDelivery} onChange={(e) => set("allowCashOnDelivery", e.target.checked)} /> Accept cash on delivery (turn off to sell only on account to approved customers)</label>
        </Card>
        <Card className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <h2 className="md:col-span-3 font-bold">Invoices</h2>
          <label className="md:col-span-3 flex items-center gap-2 text-sm"><input disabled={!canEdit} type="checkbox" checked={form.autoInvoice} onChange={(e) => set("autoInvoice", e.target.checked)} /> Create and email the invoice automatically when an order ships</label>
          <div className="md:col-span-3"><Field label="Invoice notes" hint="Printed on every invoice: bank details, payment instructions, terms"><textarea disabled={!canEdit} rows={3} className={inputCls} value={form.invoiceNotes} onChange={(e) => set("invoiceNotes", e.target.value)} /></Field></div>
        </Card>
        <Card className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <h2 className="md:col-span-3 font-bold">Quotes &amp; returns</h2>
          <Field label="Quotes valid for (days)"><input disabled={!canEdit} type="number" min={1} max={365} className={inputCls} value={form.quoteValidityDays} onChange={(e) => set("quoteValidityDays", e.target.value)} /></Field>
          <Field label="Return window (days)" hint="After shipping; 0 = customers can't request returns online"><input disabled={!canEdit} type="number" min={0} max={365} className={inputCls} value={form.returnWindowDays} onChange={(e) => set("returnWindowDays", e.target.value)} /></Field>
        </Card>
        {canEdit && <div className="flex justify-end"><button disabled={saving} className={btnPrimary}>{saving ? "Saving..." : "Save settings"}</button></div>}
      </form>
    </div>
  );
};
