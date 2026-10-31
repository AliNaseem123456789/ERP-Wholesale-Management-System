import React from "react";
import { ShieldCheck, BadgeDollarSign, Truck } from "lucide-react";

const POINTS = [
  { icon: BadgeDollarSign, text: "Your own trade prices and volume tiers" },
  { icon: Truck, text: "Order from several suppliers in one checkout" },
  { icon: ShieldCheck, text: "Every supplier is reviewed before listing" },
];

/** Split layout for sign-in and account pages: a dark brand panel beside the form (panel hidden on phones). */
export const AuthShell: React.FC<{ title: string; subtitle?: React.ReactNode; children: React.ReactNode; wide?: boolean }> = ({ title, subtitle, children, wide }) => (
  <div className="min-h-[calc(100vh-9rem)] bg-page grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
    <div className="hidden lg:flex relative overflow-hidden bg-night text-white p-12 xl:p-16 flex-col justify-between">
      <div className="absolute inset-0 opacity-40" style={{ backgroundImage: "repeating-linear-gradient(135deg, transparent 0 22px, rgb(255 255 255 / .05) 22px 23px)" }} aria-hidden="true" />
      <div className="relative">
        <p className="font-display text-[2.6rem] xl:text-5xl font-extrabold leading-[1.02]" style={{ fontStretch: "115%" }}>
          Stock your shelves at trade prices.
        </p>
        <p className="mt-5 text-white/65 text-lg max-w-md leading-relaxed">One account for every approved supplier on the marketplace.</p>
      </div>
      <ul className="relative space-y-4">
        {POINTS.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-3 text-white/85">
            <span className="w-9 h-9 rounded-lg bg-white/[0.07] ring-1 ring-inset ring-white/10 grid place-items-center text-signal"><Icon size={18} /></span>
            {text}
          </li>
        ))}
      </ul>
    </div>
    <div className="flex items-center justify-center px-4 py-10 sm:py-16">
      <div className={`w-full ${wide ? "max-w-lg" : "max-w-md"}`}>
        <div className="mb-8">
          <h1 className="font-display text-[2rem] font-extrabold text-ink leading-tight">{title}</h1>
          {subtitle && <p className="text-ink-2 mt-2">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  </div>
);

// Shared layout used by the login / password / invitation pages.
export const AuthCard: React.FC<{
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, subtitle, children }) => <AuthShell title={title} subtitle={subtitle}>{children}</AuthShell>;

export const inputClass =
  "w-full h-12 px-4 border border-line-strong rounded-lg bg-surface text-ink placeholder:text-ink-3 focus:border-brand focus:ring-4 focus:ring-brand/15 outline-none";
export const primaryButtonClass =
  "w-full h-12 bg-brand text-white rounded-lg font-semibold hover:bg-brand-hover disabled:opacity-60";
