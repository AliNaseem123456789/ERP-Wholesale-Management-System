// src/features/auth/types/auth.types.ts

export type CompanyMembership = {
  companyId: string;
  name: string;
  slug: string;
  status: "pending" | "active" | "suspended" | string;
  logoUrl?: string | null;
  role: "OWNER" | "MANAGER" | "ACCOUNTANT" | "WAREHOUSE" | "SALES" | "HR" | string;
};

export type User = {
  id: string;
  email: string;
  isPlatformAdmin?: boolean;
  emailVerified?: boolean;
  companies?: CompanyMembership[];
  role: "USER" | "ADMIN" | "SUBACCOUNT" | string;
  firstName?: string | null;
  lastName?: string | null;
  businessName?: string | null;
  phone?: string | null;
  permissions?: {
    can_place_order: boolean;
  } | null;
};

export interface LoginResponse {
  message: string;
  user: User;
  // Tokens are stored in httpOnly cookies, not in the response
}

export type RegistrationData = {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  businessName?: string;
};

export type AuthContextType = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegistrationData) => Promise<void>;
  logout: () => Promise<void>;
  logoutAllDevices: () => Promise<{ message: string; devicesLoggedOut: number }>;
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
  refreshUser: () => Promise<User | null>;
};
