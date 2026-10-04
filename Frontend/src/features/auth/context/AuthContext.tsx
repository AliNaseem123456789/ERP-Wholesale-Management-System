// frontend/src/features/auth/context/AuthContext.tsx
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { 
  getMe, 
  loginApi, 
  logoutApi, 
  registerApi, 
  refreshAccessToken,
  logoutAllDevicesApi
} from "../api/auth.api";
import { AuthContextType, RegistrationData, User } from "../types/auth.types";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const userData = await getMe();
        if (userData) {
          setUser(userData);
          setLoading(false);
          return;
        }
      } catch (error) {
        // Silent fail
      }

      try {
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          const userData = await getMe();
          if (userData) {
            setUser(userData);
            setLoading(false);
            return;
          }
        }
      } catch (refreshError) {
        // Silent fail
      }

      setUser(null);
      setLoading(false);
    };

    loadUser();
  }, []);

  // Re-reads the session (e.g. after joining a company or verifying an email).
  const refreshUser = async () => {
    const userData = await getMe();
    setUser(userData);
    return userData;
  };

  const login = async (email: string, password: string) => {
    const userData = await loginApi(email, password);
    setUser(userData);
  };

  const register = async (data: RegistrationData) => {
    const userData = await registerApi(data);
    setUser(userData);
  };

  const logout = async () => {
    await logoutApi();
    setUser(null);
  };

  // ✅ NEW: Logout from all devices
  const logoutAllDevices = async (): Promise<{ message: string; devicesLoggedOut: number }> => {
    const result = await logoutAllDevicesApi();
    // Clear local state
    setUser(null);
    return result;
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, login, register, logout, logoutAllDevices, setUser, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
};