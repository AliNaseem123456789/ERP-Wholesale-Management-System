import React, { useCallback, useEffect, useState } from "react";
import { UserPlus, Mail, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../auth/context/AuthContext";
import { useBusiness } from "../context/BusinessContext";
import { businessApi, errorMessage } from "../api/business.api";
import { Card, PageHeader, Spinner, StatusBadge, Field, inputCls, btnPrimary, dateOnly, inputBase } from "../components/ui";

export const TeamPage: React.FC = () => {
  const { user } = useAuth();
  const { companyId, company, can } = useBusiness();
  const canManage = can("members.manage");
  const [data, setData] = useState<any>(null);
  const [roles, setRoles] = useState<{ role: string; description: string }[]>([]);
  const [invite, setInvite] = useState({ email: "", role: "SALES" });
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    businessApi.members(companyId!).then(setData).catch((e) => toast.error(errorMessage(e)));
  }, [companyId]);

  useEffect(() => {
    load();
    businessApi.roles().then(setRoles).catch(() => {});
  }, [load]);

  const assignable = roles.filter((r) => r.role !== "OWNER" || company?.myRole === "OWNER");

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      const res = await businessApi.invite(companyId!, invite.email, invite.role);
      toast.success(res.message);
      setInvite({ email: "", role: invite.role });
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const change = async (memberId: number, body: { role?: string; status?: string }) => {
    try {
      await businessApi.updateMember(companyId!, memberId, body);
      toast.success("Team member updated");
      load();
    } catch (err) {
      toast.error(errorMessage(err));
      load();
    }
  };

  const remove = async (m: any) => {
    if (!window.confirm(`Remove ${m.user.email} from ${company?.name}?`)) return;
    try {
      await businessApi.removeMember(companyId!, m.id);
      toast.success("Team member removed");
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const revoke = async (id: number) => {
    try {
      await businessApi.revokeInvite(companyId!, id);
      toast.success("Invitation revoked");
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  if (!data) return <Spinner />;

  return (
    <div className="space-y-6">
      <PageHeader title="Team" subtitle="Who can work in this business, and what they can do" />

      {canManage && (
        <Card className="p-5">
          <form onSubmit={sendInvite} className="grid grid-cols-1 md:grid-cols-[1fr_200px_auto] gap-3 items-end">
            <Field label="Invite by email">
              <input type="email" required className={inputCls} placeholder="colleague@business.com" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
            </Field>
            <Field label="Role">
              <select className={inputCls} value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
                {assignable.map((r) => <option key={r.role} value={r.role}>{r.role}</option>)}
              </select>
            </Field>
            <button disabled={sending} className={btnPrimary}><UserPlus size={16} /> {sending ? "Sending..." : "Send invite"}</button>
          </form>
          <p className="text-xs text-gray-500 mt-2">{roles.find((r) => r.role === invite.role)?.description}</p>
        </Card>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50">
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last login</th>
                {canManage && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.data.map((m: any) => {
                const isMe = String(m.user.id) === user?.id;
                const editable = canManage && (m.role !== "OWNER" || company?.myRole === "OWNER");
                return (
                  <tr key={m.id}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">
                        {[m.user.first_name, m.user.last_name].filter(Boolean).join(" ") || m.user.email} {isMe && <span className="text-xs text-gray-400">(you)</span>}
                      </p>
                      <p className="text-xs text-gray-500">{m.user.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      {editable ? (
                        <select className={`${inputBase} w-auto`} value={m.role} onChange={(e) => change(m.id, { role: e.target.value })}>
                          {assignable.map((r) => <option key={r.role} value={r.role}>{r.role}</option>)}
                          {!assignable.some((r) => r.role === m.role) && <option value={m.role}>{m.role}</option>}
                        </select>
                      ) : (
                        <span className="font-semibold">{m.role}</span>
                      )}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={m.status} /></td>
                    <td className="px-4 py-3 text-gray-500">{dateOnly(m.user.last_login)}</td>
                    {canManage && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {editable && !isMe && (
                          <>
                            <button onClick={() => change(m.id, { status: m.status === "active" ? "disabled" : "active" })} className="text-xs font-semibold text-gray-600 hover:underline mr-3">
                              {m.status === "active" ? "Disable" : "Enable"}
                            </button>
                            <button onClick={() => remove(m)} className="text-xs font-semibold text-red-600 hover:underline">Remove</button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {canManage && data.invitations.length > 0 && (
        <Card>
          <div className="px-5 py-4 border-b border-gray-100 font-bold text-gray-900">Pending invitations</div>
          <ul className="divide-y divide-gray-100 text-sm">
            {data.invitations.map((i: any) => (
              <li key={i.id} className="px-5 py-3 flex items-center gap-3">
                <Mail size={16} className="text-gray-400" />
                <span className="flex-1">{i.email}</span>
                <span className="font-semibold">{i.role}</span>
                <span className="text-gray-400 text-xs">expires {dateOnly(i.expires_at)}</span>
                <button onClick={() => revoke(i.id)} className="p-1 text-gray-400 hover:text-red-600" title="Revoke"><X size={16} /></button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
};
