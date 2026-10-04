import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Building2, Globe, MapPin } from "lucide-react";
import ProductCard from "../components/ProductCard";
import { getCompany, PublicCompany } from "../api/companyApi";

// A single seller's storefront.
export const CompanyPage: React.FC = () => {
  const { slug = "" } = useParams();
  const [company, setCompany] = useState<PublicCompany | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [brand, setBrand] = useState("");

  useEffect(() => {
    setCompany(null);
    getCompany(slug).then(setCompany).catch(() => setError("This company isn't available."));
  }, [slug]);

  const products = useMemo(
    () => (company?.products || []).filter((p) => !brand || p.brand === brand),
    [company, brand],
  );

  if (error) return <div className="min-h-screen p-10 text-center text-gray-500">{error} <Link to="/companies" className="text-blue-600 underline">See all companies</Link></div>;
  if (!company) return <div className="min-h-screen p-10 text-center text-gray-500">Loading...</div>;

  return (
    <div className="min-h-screen bg-white dark:bg-[#191919] text-gray-900 dark:text-gray-200">
      <div className="bg-gray-50 border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-8 flex flex-wrap items-center gap-5">
          <div className="w-20 h-20 rounded-2xl bg-white border border-gray-200 overflow-hidden flex items-center justify-center">
            {company.logo_url ? <img src={company.logo_url} alt="" className="w-full h-full object-cover" /> : <Building2 className="text-gray-400" size={32} />}
          </div>
          <div className="flex-1 min-w-[220px]">
            <Link to="/companies" className="text-xs text-blue-600 hover:underline">← All companies</Link>
            <h1 className="text-3xl font-black text-gray-900">{company.name}</h1>
            <div className="flex flex-wrap gap-4 text-sm text-gray-500 mt-1">
              {(company.city || company.state) && <span className="flex items-center gap-1"><MapPin size={14} /> {[company.city, company.state].filter(Boolean).join(", ")}</span>}
              {company.website && <a href={company.website} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1 hover:text-blue-600"><Globe size={14} /> Website</a>}
              <span>{company.products?.length || 0} products</span>
            </div>
            {company.description && <p className="text-gray-600 mt-3 max-w-3xl whitespace-pre-line">{company.description}</p>}
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 py-8">
        {company.brands.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-6">
            <button onClick={() => setBrand("")} className={`px-3 py-1.5 rounded-full text-sm font-semibold border ${!brand ? "bg-gray-900 text-white border-gray-900" : "border-gray-200 text-gray-600"}`}>All brands</button>
            {company.brands.map((b) => (
              <button key={b.id} onClick={() => setBrand(b.name)} className={`px-3 py-1.5 rounded-full text-sm font-semibold border ${brand === b.name ? "bg-gray-900 text-white border-gray-900" : "border-gray-200 text-gray-600"}`}>{b.name}</button>
            ))}
          </div>
        )}
        {products.length === 0 ? (
          <p className="text-gray-500 text-center py-10">No products listed yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
            {products.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        )}
      </div>
    </div>
  );
};
