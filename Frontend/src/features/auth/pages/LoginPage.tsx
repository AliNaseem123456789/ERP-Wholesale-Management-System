import { AuthShell } from "../components/AuthCard";
import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import { Lock, Mail, PlayCircle, ChevronDown, Copy } from "lucide-react";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, DEMO_SELLER, demoAccountFor, type DemoAccount } from "../demoAccounts";

export const LoginPage: React.FC = () => {
  const { login } = useAuth(); 
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Only allow in-site redirects after login.
  const next = (params.get("next") || "/").startsWith("/") ? params.get("next") || "/" : "/";

  // Demo version: the form starts filled in with the seller owner's login, so a visitor can just press Sign in.
  const [email, setEmail] = useState(DEMO_SELLER.email);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [isLoading, setIsLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // a demo login goes straight to the part of the site it shows (unless the visitor was sent here from a page)
  const destination = (emailUsed: string) => {
    const demo = demoAccountFor(emailUsed);
    return demo && !params.get("next") ? demo.home : next;
  };

  const signIn = async (emailUsed: string, passwordUsed: string) => {
    setIsLoading(true);
    try {
      await login(emailUsed, passwordUsed);
      toast.success("Login successful!");
      navigate(destination(emailUsed));
    } catch (err: any) {
      toast.error(err.message || "Invalid email or password");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await signIn(email, password);
  };

  const tryAs = (a: DemoAccount) => {
    setEmail(a.email);
    setPassword(DEMO_PASSWORD);
    signIn(a.email, DEMO_PASSWORD);
  };

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => toast.success("Copied"), () => {});
  };

  return (
    <AuthShell title="Sign in" subtitle="Welcome back. Sign in to see your trade prices.">
          <div className="mb-6 rounded-xl border border-brand/30 bg-brand/[0.06] p-4">
            <div className="flex items-start gap-3">
              <PlayCircle className="w-5 h-5 text-brand-text shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">This is a demo version</p>
                <p className="text-sm text-ink-2 mt-0.5">
                  The form is filled in with a demo seller account. Press <strong>Sign in</strong> to explore the full
                  ERP with a year of sample data, or pick another role below. All companies, people and orders are
                  made up.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
              className="mt-3 flex w-full items-center justify-between text-sm font-semibold text-brand-text hover:underline"
            >
              Try a different role
              <ChevronDown size={16} className={`transition-transform ${showAll ? "rotate-180" : ""}`} />
            </button>
            {showAll && (
              <div className="mt-3 space-y-2">
                {DEMO_ACCOUNTS.map((a) => (
                  <button
                    key={a.email}
                    type="button"
                    disabled={isLoading}
                    onClick={() => tryAs(a)}
                    className="w-full text-left rounded-lg border border-line bg-surface px-3 py-2.5 hover:border-brand disabled:opacity-60 transition-colors"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-ink truncate">{a.name}</span>
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-text shrink-0">{a.role}</span>
                    </span>
                    <span className="block text-xs text-ink-3 truncate">{a.email}</span>
                    <span className="block text-xs text-ink-2 mt-0.5">{a.shows}</span>
                  </button>
                ))}
                <p className="flex items-center gap-1.5 text-xs text-ink-2 pt-1">
                  Password for every demo login:
                  <code className="font-mono font-semibold text-ink">{DEMO_PASSWORD}</code>
                  <button type="button" onClick={() => copy(DEMO_PASSWORD)} className="p-1 text-ink-3 hover:text-ink" title="Copy password">
                    <Copy size={13} />
                  </button>
                </p>
              </div>
            )}
          </div>
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
