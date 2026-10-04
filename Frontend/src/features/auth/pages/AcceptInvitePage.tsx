import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { acceptInvitationApi, getInvitationApi } from "../api/auth.api";
import { useAuth } from "../context/AuthContext";
import { AuthCard, inputClass, primaryButtonClass } from "../components/AuthCard";
import { setActiveCompanyId } from "../../business/context/activeCompany";

export const AcceptInvitePage: React.FC = () => {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();
  const { user, refreshUser, loading: authLoading } = useAuth();
  const [invite, setInvite] = useState<Awaited<ReturnType<typeof getInvitationApi>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ firstName: "", lastName: "", password: "", confirm: "" });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return setError("This invitation link is missing its token.");
    getInvitationApi(token).then(setInvite).catch((e) => setError(e.message));
  }, [token]);

  const accept = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!invite) return;
    if (!invite.hasAccount) {
      if (form.password.length < 8) return toast.error("Password must be at least 8 characters");
      if (form.password !== form.confirm) return toast.error("Passwords do not match");
    }
    setSubmitting(true);
    try {
      const res = await acceptInvitationApi(
        token,
        invite.hasAccount ? {} : { password: form.password, firstName: form.firstName, lastName: form.lastName },
      );
      await refreshUser();
      setActiveCompanyId(String(invite.company.id));
      toast.success(res.message);
      navigate("/business");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (error) {
    return (
      <AuthCard title="Invitation unavailable">
        <p className="text-center text-gray-600">{error}</p>
      </AuthCard>
    );
  }
  if (!invite || authLoading) {
    return (
      <AuthCard title="Loading invitation...">
        <Loader2 className="mx-auto animate-spin text-blue-600" size={40} />
      </AuthCard>
    );
  }

  const header = (
    <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6">
      <Building2 className="text-blue-600 shrink-0" />
      <p className="text-sm text-gray-700">
        You've been invited to join <b>{invite.company.name}</b> as <b>{invite.role}</b>.
      </p>
    </div>
  );

  // Existing account: must be logged in as the invited email.
  if (invite.hasAccount) {
    const sameUser = user && user.email.toLowerCase() === invite.email.toLowerCase();
    return (
      <AuthCard title="Join your team">
        {header}
        {sameUser ? (
          <button onClick={() => accept()} disabled={submitting} className={primaryButtonClass}>
            {submitting ? "Joining..." : `Join ${invite.company.name}`}
          </button>
        ) : (
          <div className="space-y-4 text-center">
            <p className="text-gray-600 text-sm">
              {user
                ? `You're logged in as ${user.email}, but this invitation is for ${invite.email}. Log out and sign in with that account.`
                : `Log in as ${invite.email} to accept this invitation.`}
            </p>
            {!user && (
              <Link
                to={`/login?next=${encodeURIComponent(`/accept-invite?token=${token}`)}`}
                className="inline-block text-blue-600 font-semibold hover:underline"
              >
                Log in to accept
              </Link>
            )}
          </div>
        )}
      </AuthCard>
    );
  }

  // New account
  return (
    <AuthCard title="Create your account">
      {header}
      <form onSubmit={accept} className="space-y-4">
        <input className={`${inputClass} bg-gray-100`} value={invite.email} disabled />
        <div className="grid grid-cols-2 gap-3">
          <input className={inputClass} placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          <input className={inputClass} placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
        </div>
        <input type="password" required className={inputClass} placeholder="Password (min. 8 characters)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <input type="password" required className={inputClass} placeholder="Confirm password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        <button disabled={submitting} className={primaryButtonClass}>
          {submitting ? "Creating account..." : "Create account & join"}
        </button>
      </form>
    </AuthCard>
  );
};
