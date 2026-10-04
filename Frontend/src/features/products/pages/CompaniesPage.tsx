import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, MapPin, Search } from "lucide-react";
import { getCompanies, PublicCompany } from "../api/companyApi";

// Directory of every active seller on the platform.
export const CompaniesPage: React.FC = () => {
  const [q, setQ] = useState("");
  const [companies, setCompanies] = useState<PublicCompany[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      getCompanies(q).then(setCompanies).catch(() => setError("Couldn't load companies"));
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#191919] py-10">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-black text-gray-900 dark:text-white">Wholesale suppliers</h1>
            <p className="text-gray-500 mt-1">Browse every company selling on the marketplace.</p>
          </div>
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies" className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
        </div>
        {error && <p className="text-red-500">{error}</p>}
        {!companies ? (
          <p className="text-gray-500">Loading...</p>
        ) : companies.length === 0 ? (
          <p className="text-gray-500">No companies found.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {companies.map((c) => (
              <Link key={c.id} to={`/companies/${c.slug}`} className="bg-white border border-gray-200 rounded-2xl p-5 hover:shadow-md hover:border-blue-200 transition-all">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gray-100 overflow-hidden flex items-center justify-center">
                    {c.logo_url ? <img src={c.logo_url} alt="" className="w-full h-full object-cover" /> : <Building2 className="text-gray-400" />}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 truncate">{c.name}</p>
                    <p className="text-xs text-gray-500">{c.productCount} products</p>
                  </div>
                </div>
                {c.description && <p className="text-sm text-gray-600 mt-3 line-clamp-2">{c.description}</p>}
                {(c.city || c.state) && (
                  <p className="text-xs text-gray-400 mt-3 flex items-center gap-1"><MapPin size={12} /> {[c.city, c.state].filter(Boolean).join(", ")}</p>
                )}
                {c.brands.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-3">
                    {c.brands.slice(0, 5).map((b) => <span key={b.id} className="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{b.name}</span>)}
                    {c.brands.length > 5 && <span className="text-[11px] text-gray-400">+{c.brands.length - 5}</span>}
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
