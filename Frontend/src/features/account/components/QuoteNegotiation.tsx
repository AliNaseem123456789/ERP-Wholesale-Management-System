// Buyer side of a quote conversation: messages, counter-offers (proposed prices / quantities / total) and earlier versions.
import React, { useEffect, useState } from "react";
import { MessageSquare, History, Send, Scale } from "lucide-react";
import { toast } from "sonner";
import { documentsApi, errorText, money, dateOnly } from "../api/documents.api";

type Message = { id: number; author_side: "customer" | "seller"; author?: string | null; body?: string | null; version: number; created_at: string; proposal?: { lines?: { item_id: number; unit_price?: number; quantity?: number }[]; total?: number | null } | null };
type Version = { version: number; created_at: string; snapshot: { items: { item_id: number; title: string; quantity: number; unit_price: number; line_total: number }[]; total: number; valid_until?: string; lead_time_days?: number | null; notes?: string | null } };

/** One message, with a proposal (if any) rendered as a list of changes. */
export const MessageBubble: React.FC<{ m: Message; mine: boolean; titleOf: (itemId: number) => string }> = ({ m, mine, titleOf }) => (
  <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
    <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${mine ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-900"}`}>
      <p className={`text-[10px] font-bold uppercase ${mine ? "text-blue-100" : "text-gray-500"}`}>
        {m.author || (m.author_side === "seller" ? "Seller" : "You")} · v{m.version} · {new Date(m.created_at).toLocaleString()}
      </p>
      {m.proposal && (m.proposal.lines?.length || m.proposal.total != null) && (
        <div className={`mt-1 rounded-lg px-3 py-2 ${mine ? "bg-white/10" : "bg-white"}`}>
          <p className="font-bold flex items-center gap-1"><Scale size={13} /> Proposed changes</p>
          <ul className="mt-1 space-y-0.5">
            {(m.proposal.lines || []).map((l) => (
              <li key={l.item_id}>{titleOf(l.item_id)}: {[l.quantity !== undefined && `qty ${l.quantity}`, l.unit_price !== undefined && `${money(l.unit_price)} each`].filter(Boolean).join(", ")}</li>
            ))}
            {m.proposal.total != null && <li>Target total: <b>{money(m.proposal.total)}</b></li>}
          </ul>
        </div>
      )}
      {m.body && <p className="mt-1 whitespace-pre-line">{m.body}</p>}
    </div>
  </div>
);

export const QuoteNegotiation: React.FC<{ quote: any; onChanged: () => void }> = ({ quote, onChanged }) => {
  const [detail, setDetail] = useState<{ messages: Message[]; versions: Version[] } | null>(null);
  const [text, setText] = useState("");
  const [countering, setCountering] = useState(false);
  const [lines, setLines] = useState<Record<string, { unit_price: string; quantity: string }>>({});
  const [total, setTotal] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [showVersion, setShowVersion] = useState<number | null>(null);

  const load = () => documentsApi.quote(quote.id).then((d: any) => setDetail({ messages: d.messages || [], versions: d.versions || [] })).catch(() => setDetail({ messages: [], versions: [] }));
  useEffect(() => { load(); }, [quote.id, quote.status, quote.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const titleOf = (itemId: number) => {
    const i = quote.items?.find((x: any) => String(x.id) === String(itemId));
    return i ? `${i.description || i.title}${i.flavor ? ` · ${i.flavor}` : ""}` : "a line from an earlier version";
  };

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await documentsApi.quoteMessage(quote.id, text.trim());
      setText("");
      load();
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };
  const counter = async (e: React.FormEvent) => {
    e.preventDefault();
    const out = Object.entries(lines).map(([item_id, v]) => ({
      item_id: Number(item_id),
      ...(v.unit_price !== "" ? { unit_price: Number(v.unit_price) } : {}),
      ...(v.quantity !== "" ? { quantity: Number(v.quantity) } : {}),
    })).filter((l) => l.unit_price !== undefined || l.quantity !== undefined);
    setBusy(true);
    try {
      const r = await documentsApi.counterQuote(quote.id, { message: note.trim() || undefined, lines: out, total: total !== "" ? Number(total) : undefined });
      toast.success(r.message);
      setCountering(false); setLines({}); setTotal(""); setNote("");
      onChanged();
    } catch (err) { toast.error(errorText(err)); } finally { setBusy(false); }
  };

  const canTalk = !["accepted", "declined", "cancelled", "expired"].includes(quote.status);

  return (
    <div className="space-y-4">
      {quote.can_counter && !countering && (
        <button onClick={() => setCountering(true)} className="inline-flex items-center gap-1 text-sm font-bold text-purple-700 hover:underline"><Scale size={14} /> Ask for a better price or other quantities</button>
      )}
      {countering && (
        <form onSubmit={counter} className="bg-purple-50 border border-purple-100 rounded-xl p-4 space-y-3 text-sm">
          <p className="font-bold text-gray-900">Your counter-offer</p>
          <p className="text-gray-600">Change only what you want different. The seller can accept it as a new version or reply.</p>
          <table className="w-full">
            <thead><tr className="text-left text-[10px] uppercase text-gray-500"><th className="py-1">Line</th><th className="w-28">Quantity</th><th className="w-32">Unit price</th></tr></thead>
            <tbody>
              {(quote.items || []).map((i: any) => (
                <tr key={i.id}>
                  <td className="py-1 pr-2 text-gray-900">{titleOf(i.id)}</td>
                  <td className="pr-2"><input type="number" min={1} step={1} placeholder={String(i.quantity)} aria-label={`Quantity for ${titleOf(i.id)}`} className="w-full border border-gray-300 rounded-lg px-2 py-1 bg-white text-gray-900"
                    value={lines[i.id]?.quantity ?? ""} onChange={(e) => setLines({ ...lines, [i.id]: { unit_price: lines[i.id]?.unit_price ?? "", quantity: e.target.value } })} /></td>
                  <td><input type="number" min={0} step="0.01" placeholder={Number(i.unit_price).toFixed(2)} aria-label={`Unit price for ${titleOf(i.id)}`} className="w-full border border-gray-300 rounded-lg px-2 py-1 bg-white text-gray-900"
                    value={lines[i.id]?.unit_price ?? ""} onChange={(e) => setLines({ ...lines, [i.id]: { quantity: lines[i.id]?.quantity ?? "", unit_price: e.target.value } })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <label className="block"><span className="text-xs font-bold text-gray-500 uppercase">Or a target total</span>
            <input type="number" min={0} step="0.01" placeholder={Number(quote.total_amount).toFixed(2)} className="mt-1 w-40 block border border-gray-300 rounded-lg px-2 py-1 bg-white text-gray-900" value={total} onChange={(e) => setTotal(e.target.value)} />
          </label>
          <label className="block"><span className="text-xs font-bold text-gray-500 uppercase">Message</span>
            <textarea rows={2} maxLength={4000} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1 bg-white text-gray-900" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. We can commit to 500 units a month at this price" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCountering(false)} className="px-4 py-2 rounded-lg border border-gray-300 bg-white font-bold text-gray-700">Cancel</button>
            <button disabled={busy} className="px-4 py-2 rounded-lg bg-purple-600 text-white font-bold disabled:opacity-50">{busy ? "Sending…" : "Send counter-offer"}</button>
          </div>
        </form>
      )}

      {detail && (detail.messages.length > 0 || canTalk) && (
        <div className="border border-gray-200 rounded-xl p-4">
          <p className="font-bold text-gray-900 flex items-center gap-1 mb-3"><MessageSquare size={15} /> Conversation with {quote.company?.name || "the seller"}</p>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {detail.messages.length === 0 ? <p className="text-sm text-gray-500">No messages yet.</p> : detail.messages.map((m) => <MessageBubble key={m.id} m={m} mine={m.author_side === "customer"} titleOf={titleOf} />)}
          </div>
          {canTalk && (
            <div className="flex gap-2 mt-3">
              <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} maxLength={4000} placeholder="Write a message" aria-label="Message to the seller"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900 text-sm" />
              <button onClick={send} disabled={busy || !text.trim()} className="px-3 py-2 rounded-lg bg-gray-900 text-white disabled:opacity-40" aria-label="Send"><Send size={15} /></button>
            </div>
          )}
        </div>
      )}

      {detail && detail.versions.length > 1 && (
        <div className="border border-gray-200 rounded-xl p-4 text-sm">
          <p className="font-bold text-gray-900 flex items-center gap-1 mb-2"><History size={15} /> Versions</p>
          <ul className="space-y-1">
            {detail.versions.map((v) => (
              <li key={v.version}>
                <button onClick={() => setShowVersion(showVersion === v.version ? null : v.version)} className="w-full flex justify-between gap-3 hover:text-blue-600">
                  <span>Version {v.version}{v.version === quote.version ? " (current)" : ""} · {dateOnly(v.created_at)}</span>
                  <span className="font-semibold">{money(v.snapshot.total)}</span>
                </button>
                {showVersion === v.version && (
                  <div className="mt-1 mb-2 pl-3 border-l-2 border-gray-200 text-gray-600">
                    {v.snapshot.items.map((i) => <p key={i.item_id}>{i.quantity} × {i.title} @ {money(i.unit_price)} = {money(i.line_total)}</p>)}
                    {v.snapshot.lead_time_days != null && <p>Delivery in {v.snapshot.lead_time_days} days</p>}
                    {v.snapshot.notes && <p>Note: {v.snapshot.notes}</p>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
