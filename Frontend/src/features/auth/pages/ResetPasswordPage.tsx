import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { resetPasswordApi } from "../api/auth.api";
import { AuthCard, inputClass, primaryButtonClass } from "../components/AuthCard";

export const ResetPasswordPage: React.FC = () => {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <AuthCard title="Invalid link">
        <p className="text-center text-gray-600">
          This reset link is missing its token.{" "}
          <Link to="/forgot-password" className="text-blue-600 font-semibold hover:underline">
            Request a new one
          </Link>
          .
        </p>
      </AuthCard>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Password must be at least 8 characters");
    if (password !== confirm) return setError("Passwords do not match");
    setLoading(true);
    try {
      const res = await resetPasswordApi(token, password);
      toast.success(res.message);
      navigate("/login");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={submit} className="space-y-5">
        <input type="password" required autoFocus placeholder="New password (min. 8 characters)" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
        <input type="password" required placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
        {error && (
          <p className="text-sm text-red-600">
            {error}{" "}
            {/expired|invalid/i.test(error) && (
              <Link to="/forgot-password" className="underline font-semibold">Request a new link</Link>
            )}
          </p>
        )}
        <button disabled={loading} className={primaryButtonClass}>
          {loading ? "Saving..." : "Update password"}
        </button>
      </form>
    </AuthCard>
  );
};
