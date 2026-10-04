import React, { useState } from "react";
import { MailWarning } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import { resendVerificationApi } from "../api/auth.api";

// Reminder shown to logged-in users who haven't confirmed their email yet.
export const VerifyEmailBanner: React.FC = () => {
  const { user } = useAuth();
  const [hidden, setHidden] = useState(false);
  const [sending, setSending] = useState(false);
  if (!user || user.emailVerified !== false || hidden) return null;

  const resend = async () => {
    setSending(true);
    try {
      const res = await resendVerificationApi();
      toast.success(res.message);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-amber-50 border-b border-amber-200 text-amber-900 text-sm">
      <div className="max-w-7xl mx-auto px-4 py-2 flex flex-wrap items-center gap-3">
        <MailWarning size={18} className="shrink-0" />
        <span className="flex-1">
          Please confirm your email address <b>{user.email}</b> (check your inbox).
        </span>
        <button onClick={resend} disabled={sending} className="font-semibold underline disabled:opacity-50">
          {sending ? "Sending..." : "Resend email"}
        </button>
        <button onClick={() => setHidden(true)} className="text-amber-700 hover:text-amber-900" aria-label="Dismiss">
          ✕
        </button>
      </div>
    </div>
  );
};
