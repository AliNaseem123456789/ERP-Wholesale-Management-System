import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/context/AuthContext";
import { CompanyMembership } from "../../auth/types/auth.types";
import { businessApi } from "../api/business.api";
import { getActiveCompanyId, setActiveCompanyId, ACTIVE_COMPANY_EVENT } from "./activeCompany";

type CompanyProfile = Record<string, any> & {
  id: number;
  name: string;
  slug: string;
  status: string;
  myRole: string;
  myPermissions: string[];
};

type BusinessContextType = {
  companies: CompanyMembership[];
  companyId: string | null;
  company: CompanyProfile | null;
  loading: boolean;
  switchCompany: (id: string) => void;
  reloadCompany: () => Promise<void>;
  can: (permission: string) => boolean;
};

const BusinessContext = createContext<BusinessContextType | undefined>(undefined);

// Same wildcard rules as the backend ("*", "orders.*").
export const hasPermission = (perms: string[] | undefined, permission: string) => {
  if (!perms) return false;
  const area = permission.split(".")[0];
  return perms.includes("*") || perms.includes(permission) || perms.includes(`${area}.*`);
};

export const BusinessProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const companies = user?.companies || [];
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Pick the remembered company if the user still belongs to it, otherwise the first one.
  useEffect(() => {
    const saved = getActiveCompanyId();
    const valid = companies.find((c) => c.companyId === saved) || companies[0];
    setCompanyId(valid ? valid.companyId : null);
    if (!valid) setLoading(false);
  }, [user]);

  const reloadCompany = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      setCompany(await businessApi.profile(companyId));
    } catch {
      setCompany(null);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    reloadCompany();
  }, [reloadCompany]);

  const switchCompany = (id: string) => {
    setActiveCompanyId(id);
    setCompany(null);
    setCompanyId(id);
  };

  // e.g. a notification for another company was opened
  useEffect(() => {
    const onChange = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id && id !== companyId && companies.some((c) => c.companyId === id)) {
        setCompany(null);
        setCompanyId(id);
      }
    };
    window.addEventListener(ACTIVE_COMPANY_EVENT, onChange);
    return () => window.removeEventListener(ACTIVE_COMPANY_EVENT, onChange);
  }, [companyId, companies]);

  const value = useMemo(
    () => ({
      companies,
      companyId,
      company,
      loading,
      switchCompany,
      reloadCompany,
      can: (p: string) => hasPermission(company?.myPermissions, p),
    }),
    [companies, companyId, company, loading, reloadCompany],
  );

  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
};

export const useBusiness = () => {
  const ctx = useContext(BusinessContext);
  if (!ctx) throw new Error("useBusiness must be used inside BusinessProvider");
  return ctx;
};
