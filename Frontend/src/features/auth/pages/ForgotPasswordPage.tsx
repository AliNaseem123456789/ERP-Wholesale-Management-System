import React, { useState } from "react";
import { Link } from "react-router-dom";
import { MailCheck } from "lucide-react";
import { forgotPasswordApi } from "../api/auth.api";
import { AuthCard, inputClass, primaryButtonClass } from "../components/AuthCard";

export const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await forgotPasswordApi(email);
      setSent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <AuthCard title="Check your email">
        <div className="text-center space-y-4">
          <MailCheck className="mx-auto text-green-600" size={48} />
          <p className="text-gray-600">
            If an account exists for <b>{email}</b>, we've sent a link to reset your password. The link
            expires in 1 hour.
          </p>
          <Link to="/login" className="text-blue-600 font-semibold hover:underline">
            Back to login
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Forgot password?" subtitle="Enter your email and we'll send you a reset link.">
      <form onSubmit={submit} className="space-y-5">
        <input
          type="email"
          required
          autoFocus
          placeholder="you@business.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={loading} className={primaryButtonClass}>
          {loading ? "Sending..." : "Send reset link"}
        </button>
        <p className="text-center text-sm">
          <Link to="/login" className="text-blue-600 font-semibold hover:underline">
            Back to login
          </Link>
        </p>
      </form>
    </AuthCard>
  );
};
