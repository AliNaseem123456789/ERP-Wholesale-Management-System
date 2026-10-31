import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Mail, Phone, MapPin, ShieldCheck, Truck, BadgeDollarSign } from "lucide-react";


/** The wordmark on dark: a cobalt crate mark and "ERP Wholesale". */
const Logo: React.FC = () => (
  <Link to="/" className="flex items-center gap-2.5 shrink-0" aria-label="ERP Wholesale, home">
    <span className="grid place-items-center rounded-md bg-brand text-white w-8 h-8" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round">
        <path d="M3 8.5 12 4l9 4.5v7L12 20l-9-4.5z" />
        <path d="M3 8.5 12 13l9-4.5M12 13v7" />
      </svg>
    </span>
    <span className="font-display leading-none text-[19px] font-extrabold text-white">
      ERP<span className="font-semibold ml-1 text-white/70">Wholesale</span>
    </span>
  </Link>
);

const COLUMNS: { title: string; links: { label: string; to: string }[] }[] = [
  {
    title: "Marketplace",
    links: [
      { label: "All products", to: "/products" },
      { label: "Categories", to: "/categories" },
      { label: "Brands", to: "/brands" },
      { label: "Suppliers", to: "/companies" },
      { label: "Deals", to: "/deals" },
    ],
  },
  {
    title: "Buying",
    links: [
      { label: "My account", to: "/account" },
      { label: "Orders and invoices", to: "/account?tab=orders" },
      { label: "Compare products", to: "/compare" },
      { label: "FAQ", to: "/FAQ" },
      { label: "Contact us", to: "/contact" },
    ],
  },
  {
    title: "Selling",
    links: [
      { label: "Start selling", to: "/business" },
      { label: "Back office", to: "/business" },
      { label: "Register a business", to: "/register" },
    ],
  },
];

const PROMISES = [
  { icon: ShieldCheck, title: "Approved suppliers", text: "Every seller is reviewed before listing." },
  { icon: BadgeDollarSign, title: "Your trade prices", text: "Volume tiers and account pricing after sign-in." },
  { icon: Truck, title: "One checkout", text: "Order from several suppliers at once." },
];

export const Footer: React.FC = () => {
  const { pathname } = useLocation();
  // the back office is a work tool: no marketing footer there
  if (pathname.startsWith("/business")) return null;
  return (
    <footer className="w-full mt-16 bg-night text-white/75">
      {/* the original "Shop Smarter, Save Bigger!" band, kept exactly as designed */}
      <div className="classic">
      <div
        className="relative text-white px-4 sm:px-6 py-8 sm:py-10"
        style={{
          backgroundImage: "url('/logos/galaxy.jpeg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>

        <div className="relative max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          <div className="text-center md:text-left">
            <p className="text-sm opacity-90 mb-2">
              Unbeatable Deals, Endless Choices – Shop Now!
            </p>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold leading-tight">
              Shop Smarter, Save Bigger!
            </h2>
          </div>
          <div className="flex flex-wrap justify-center md:justify-end gap-3 sm:gap-4">
            {["footer1.jpg", "footer2.jpg", "footer3.jpg", "footer4.jpg"].map(
              (img, i) => (
                <img
                  key={i}
                  src={`/logos/${img}`}
                  alt={`Footer ${i + 1}`}
                  className="
                    aspect-square
                    w-20 sm:w-24 md:w-28 lg:w-32
                    object-cover
                    rounded-lg
                    shadow-lg
                  "
                />
              )
            )}
          </div>
        </div>
      </div>
      </div>

      <div className="border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 py-8 grid gap-6 sm:grid-cols-3">
          {PROMISES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex items-start gap-3">
              <span className="w-10 h-10 rounded-lg bg-white/[0.06] ring-1 ring-inset ring-white/10 grid place-items-center text-signal shrink-0"><Icon size={19} /></span>
              <div>
                <p className="font-semibold text-white">{title}</p>
                <p className="text-sm text-white/60">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-12 grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)_1.3fr]">
        <div className="space-y-4">
          <Logo />
          <p className="text-sm leading-relaxed text-white/60 max-w-xs">
            A wholesale marketplace and back office for distributors and the retailers they supply.
          </p>
          <form className="pt-2 max-w-xs" onSubmit={(e) => e.preventDefault()} aria-label="Newsletter">
            <label htmlFor="footer-email" className="block text-sm font-semibold text-white mb-2">Trade news and price drops</label>
            <div className="flex rounded-lg bg-white/[0.06] ring-1 ring-inset ring-white/15 focus-within:ring-white/40 overflow-hidden">
              <input id="footer-email" type="email" placeholder="you@business.com" className="flex-1 min-w-0 bg-transparent px-3 py-2.5 text-sm text-white placeholder:text-white/40 outline-none" />
              <button className="px-4 text-sm font-semibold bg-[#fff] text-[#0F1B2D] hover:bg-[#e8ebf0]">Subscribe</button>
            </div>
          </form>
        </div>

        {COLUMNS.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <h2 className="font-sans text-sm font-semibold text-white mb-3" style={{ fontStretch: "100%", letterSpacing: 0 }}>{col.title}</h2>
            <ul className="space-y-2 text-sm">
              {col.links.map((l) => (
                <li key={l.label}><Link to={l.to} className="hover:text-white">{l.label}</Link></li>
              ))}
            </ul>
          </nav>
        ))}

        <div>
          <h2 className="font-sans text-sm font-semibold text-white mb-3" style={{ fontStretch: "100%", letterSpacing: 0 }}>Contact</h2>
          <ul className="space-y-2.5 text-sm">
            <li className="flex gap-2.5"><Mail size={16} className="mt-0.5 shrink-0 text-white/40" /><a href="mailto:support@ERPwholesale.com" className="hover:text-white break-all">support@ERPwholesale.com</a></li>
            <li className="flex gap-2.5"><Phone size={16} className="mt-0.5 shrink-0 text-white/40" /><a href="tel:+15164854343" className="hover:text-white">(516) 485-4343</a></li>
            <li className="flex gap-2.5"><MapPin size={16} className="mt-0.5 shrink-0 text-white/40" /><span>34 Nassau Blvd, Garden City, NY 11530</span></li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="max-w-7xl mx-auto px-6 py-5 flex flex-col md:flex-row gap-2 md:items-center md:justify-between text-xs text-white/50">
          <p>© {new Date().getFullYear()} ERP Wholesale. All rights reserved.</p>
          <p>Warning: some products contain nicotine, an addictive chemical. Not for sale to minors.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
