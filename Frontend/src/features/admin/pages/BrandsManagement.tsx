import React, { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { adminService } from "../api/admin.service";
import { errorMessage } from "../../business/api/business.api";
import { Card, Spinner, inputCls, inputBase } from "../../business/components/ui";

// Assign brands (and every product of that brand) to the company that owns them.
export const BrandsManagement: React.FC = () => {
  const [brands, setBrands] = useState<any[] | null>(null);
  const [companies, setCompanies] = useState<any[]>([]);
  const [search, setSearch] = useState("");

  const load = () =>
    Promise.all([adminService.getAllBrands(), adminService.getCompanies()])
      .then(([b, c]) => {
        setBrands(b);
        setCompanies(c);
      })
      .catch((e) => toast.error(errorMessage(e)));

  useEffect(() => {
    load();
  }, []);

  const assign = async (brand: any, companyId: string) => {
    const company = companies.find((c) => String(c.id) === companyId);
    if (!company) return;
    if (!window.confirm(`Move "${brand.name}" and its ${brand.productCount} product(s) to ${company.name}?`)) return;
    try {
      const res = await adminService.assignBrand(brand.id, company.id);
      toast.success(res.message);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const visible = (brands || []).filter((b) => !search || b.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h2 className="text-xl font-black text-gray-900">Brands</h2>
          <p className="text-sm text-gray-500">Moving a brand also moves all of its products to the new company.</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input className={`${inputCls} pl-9 w-56`} placeholder="Search brands" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <Card>
        {!brands ? (
          <Spinner />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase text-gray-400 bg-gray-50">
                <th className="px-4 py-3">Brand</th>
                <th className="px-4 py-3 text-center">Products</th>
                <th className="px-4 py-3">Company</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-3 font-semibold text-gray-900">{b.name}</td>
                  <td className="px-4 py-3 text-center">{b.productCount}</td>
                  <td className="px-4 py-3">
                    <select className={`${inputBase} w-64`} value={b.company ? String(b.company.id) : ""} onChange={(e) => assign(b, e.target.value)}>
                      {!b.company && <option value="">Unassigned</option>}
                      {companies.map((c) => (
                        <option key={c.id} value={String(c.id)}>{c.name}{c.status !== "active" ? ` (${c.status})` : ""}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
};
