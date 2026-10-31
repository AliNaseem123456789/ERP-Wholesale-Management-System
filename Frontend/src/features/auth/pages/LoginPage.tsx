import { AuthShell } from "../components/AuthCard";
import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import { Lock, Mail } from "lucide-react";

export const LoginPage: React.FC = () => {
  const { login } = useAuth(); 
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Only allow in-site redirects after login.
  const next = (params.get("next") || "/").startsWith("/") ? params.get("next") || "/" : "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await login(email, password); 
      toast.success("Login successful!");
      navigate(next);
    } catch (err: any) {
      toast.error(err.message || "Invalid email or password");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell title="Sign in" subtitle="Welcome back. Sign in to see your trade prices.">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-ink mb-1.5">
                Email address
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-ink-3" />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full h-12 pl-11 pr-4 border border-line-strong rounded-lg bg-surface text-ink focus:border-brand focus:ring-4 focus:ring-brand/15 outline-none"
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-ink mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-ink-3" />
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full h-12 pl-11 pr-4 border border-line-strong rounded-lg bg-surface text-ink focus:border-brand focus:ring-4 focus:ring-brand/15 outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end -mt-3">
              <Link to="/forgot-password" className="text-sm text-brand-text font-semibold hover:underline">
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-12 bg-brand text-white rounded-lg font-semibold hover:bg-brand-hover disabled:opacity-60"
            >
              {isLoading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="text-sm mt-8 pt-6 border-t border-line text-ink-2">
            New wholesale customer?{" "}
            <Link to="/register" className="text-brand-text font-semibold hover:underline">
              Open an account
            </Link>
          </p>
    </AuthShell>
  );
};
