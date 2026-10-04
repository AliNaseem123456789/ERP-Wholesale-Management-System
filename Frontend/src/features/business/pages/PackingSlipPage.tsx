import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Printer, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { errorMessage } from "../api/business.api";
import { supplyApi } from "../api/supply.api";
import { Card, Spinner, dateOnly, btnPrimary } from "../components/ui";

// Pick list (where to pick each line) + packing slip, printable on one page.
export const PackingSlipPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { companyId } = useBusiness();
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    supplyApi.pickList(companyId!, id!).then(setD).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, id]);
  if (!d) return <Spinner />;
  const { order, company, warehouse, lines } = d;
  // Once an order has shipped, this is just a packing slip (no pick locations).
  const showPicks = !["shipped", "delivered", "cancelled"].includes(order.status);
  const a = order.shipping_address;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 no-print">
        <button onClick={() => navigate(`/business/orders?open=${order.id}`)} className="text-sm text-blue-600 font-semibold flex items-center gap-1 hover:underline"><ArrowLeft size={16} /> Back to order</button>
        <span className="flex-1" />
        <button onClick={() => window.print()} className={btnPrimary}><Printer size={16} /> Print</button>
      </div>
      <Card className="p-8 print-area text-sm">
        <div className="flex justify-between gap-6 mb-6">
          <div>
            <p className="text-xs font-bold uppercase text-gray-400 tracking-widest">Packing slip</p>
            <h1 className="text-3xl font-black">{order.order_number}</h1>
            <p className="text-gray-500">
              Ordered {dateOnly(order.created_at)}
              {showPicks ? <> · Pick from <b>{warehouse.name} ({warehouse.code})</b></> : order.tracking_number ? <> · Tracking <b>{order.tracking_number}</b></> : null}
            </p>
          </div>
          <div className="text-right">
            <p className="font-bold">{company.name}</p>
            <p className="text-gray-500">{company.address}</p>
            <p className="text-gray-500">{company.phone}</p>
          </div>
        </div>
        <div className="mb-6">
          <p className="text-[10px] font-bold uppercase text-gray-400">Ship to</p>
          {a ? (
            <p className="font-semibold leading-relaxed">
              {order.business_name && <>{order.business_name}<br /></>}
              {a.full_name}<br />{a.address_line1}{a.address_line2 && <>, {a.address_line2}</>}<br />{a.city}, {a.state} {a.postal_code}{a.phone && <><br />{a.phone}</>}
            </p>
          ) : <p>—</p>}
        </div>
        {order.compliance?.flags?.length > 0 && (
          <div className="mb-6 border-2 border-black rounded-lg px-3 py-2 font-bold">
            {order.compliance.flags.map((f: string) => <p key={f}>⚠ {f}</p>)}
          </div>
        )}
        <table className="w-full">
          <thead><tr className="text-left text-[10px] uppercase text-gray-500 border-b-2 border-gray-300">
            <th className="py-2 w-8">✓</th><th>Product</th><th>SKU / barcode</th><th className="text-right pr-4">Qty</th>{showPicks && <th className="pl-4">Pick from (bin · lot · expiry)</th>}
          </tr></thead>
          <tbody>
            {lines.map((l: any, i: number) => (
              <tr key={i} className="border-b border-gray-200 align-top">
                <td className="py-3"><span className="inline-block w-4 h-4 border border-gray-400 rounded-sm" /></td>
                <td className="py-3 font-semibold">{l.title}</td>
                <td className="py-3 text-gray-600">{[l.sku, l.barcode].filter(Boolean).join(" / ") || "—"}</td>
                <td className="py-3 text-right pr-4 font-black text-base">{l.quantity}</td>
                {showPicks && <td className="py-3 pl-4">
                  {l.picks.length === 0 && !l.short ? "—" : l.picks.map((p: any, j: number) => (
                    <div key={j}>{p.quantity} × {[p.bin && `bin ${p.bin}`, p.lot_number && `lot ${p.lot_number}`, p.expiry_date && `exp ${dateOnly(p.expiry_date)}`].filter(Boolean).join(" · ") || "no location"}</div>
                  ))}
                  {l.short > 0 && <div className="text-red-600 font-bold">Short by {l.short}</div>}
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-8 text-xs text-gray-500">Products may contain nicotine. Sale restricted to adults 21+.</p>
      </Card>
    </div>
  );
};
