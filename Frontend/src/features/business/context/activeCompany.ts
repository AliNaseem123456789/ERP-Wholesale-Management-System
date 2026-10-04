// Remembers which company the user is working in (per browser).
const KEY = "activeCompanyId";

export const getActiveCompanyId = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

export const setActiveCompanyId = (id: string | null) => {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: selection just won't persist */
  }
};

// Lets code outside the back office (e.g. the notifications bell) switch the active company.
export const ACTIVE_COMPANY_EVENT = "active-company-change";
export const announceActiveCompany = (id: string) => {
  setActiveCompanyId(id);
  try {
    window.dispatchEvent(new CustomEvent(ACTIVE_COMPANY_EVENT, { detail: id }));
  } catch {
    /* old browsers: the stored value is still picked up on the next load */
  }
};
