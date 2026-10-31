import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { PlayCircle, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { demoAccountFor } from "../demoAccounts";

const DISMISS_KEY = "demo-banner-dismissed";
const readDismissed = () => {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * Demo version strip under the header.
 * Signed out: invites visitors to sign in with the demo seller and try the ERP (can be closed for the visit).
 * Signed in with a demo login: says which demo role this is and offers to switch to another one.
 */
export const DemoBanner: React.FC = () => {
  const { user, loading, logout } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(readDismissed);

  if (loading || pathname === "/login") return null;
  const demo = user ? demoAccountFor(user.email || "") : undefined;

  if (user && demo) {
    // leave the protected page first, so signing out doesn't bounce through "please sign in"
    const switchRole = async () => {
      navigate("/login");
      await logout();
    };
    return (
      <div className="bg-night text-white text-sm">
        <div className="mx-auto max-w-7xl px-4 py-2 flex items-center justify-center gap-x-3 gap-y-1 flex-wrap text-center">
          <PlayCircle size={16} className="text-signal shrink-0" />
          <span>
            Demo: you're signed in as <strong>{demo.name}</strong> ({demo.role}). All data is sample data.
          </span>
          <button type="button" onClick={switchRole} className="font-semibold text-signal hover:underline">
            Switch role
          </button>
        </div>
      </div>
    );
  }

  if (user || dismissed) return null;
  const close = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private mode: closes for this page only */
    }
  };
  return (
    <div className="bg-night text-white text-sm">
      <div className="mx-auto max-w-7xl px-4 py-2 flex items-center justify-center gap-3">
        <PlayCircle size={16} className="text-signal shrink-0 hidden sm:block" />
        <span className="text-center">
          <span className="font-semibold">Demo version.</span>{" "}
          <span className="text-white/75 hidden sm:inline">Sign in as a demo seller to explore the full ERP: orders, stock, invoices, HR and reports.</span>
          <span className="text-white/75 sm:hidden">Explore the full ERP.</span>
        </span>
        <Link to="/login" className="shrink-0 rounded-md bg-signal px-3 py-1 font-semibold text-signal-ink hover:opacity-90">
          Try the demo
        </Link>
        <button type="button" onClick={close} aria-label="Close" className="shrink-0 p-1 text-white/60 hover:text-white">
          <X size={16} />
        </button>
      </div>
    </div>
  );
};
