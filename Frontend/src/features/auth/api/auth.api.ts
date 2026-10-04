// frontend/src/features/auth/api/auth.api.ts
import { API_URL } from "../../../config/config";
import { RegistrationData, User } from "../types/auth.types";

const authFetch = (path: string, options: RequestInit = {}) =>
  fetch(`${API_URL}${path}`, { ...options, credentials: "include" });

const readJson = async (res: Response) => res.json().catch(() => ({}));

export async function getMe(): Promise<User | null> {
  const res = await authFetch("/auth/me");
  if (!res.ok) return null;
  const data = await readJson(res);
  return data.user ?? null;
}

export async function loginApi(email: string, password: string): Promise<User> {
  const res = await authFetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data.message || "Login failed");
  return data.user;
}

export async function registerApi(payload: RegistrationData): Promise<User> {
  const res = await authFetch("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data.message || "Registration failed");
  return data.user;
}

export async function logoutApi(): Promise<void> {
  await authFetch("/auth/logout", { method: "POST" });
}

// Uses the long-lived refresh cookie to issue a new short-lived access cookie.
export const refreshAccessToken = async (): Promise<boolean> => {
  try {
    const res = await authFetch("/auth/refresh", { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
};

export const logoutAllDevicesApi = async (): Promise<{
  message: string;
  devicesLoggedOut: number;
}> => {
  const res = await authFetch("/auth/logout-all", { method: "POST" });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data.message || "Logout from all devices failed");
  return data;
};

// ============================================
// PASSWORD & EMAIL FLOWS
// ============================================
const postJson = async (path: string, body?: unknown) => {
  const res = await authFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data.message || "Something went wrong");
  return data;
};

export const forgotPasswordApi = (email: string) =>
  postJson("/auth/forgot-password", { email });

export const resetPasswordApi = (token: string, password: string) =>
  postJson("/auth/reset-password", { token, password });

export const changePasswordApi = (currentPassword: string, newPassword: string) =>
  postJson("/auth/change-password", { currentPassword, newPassword });

export const verifyEmailApi = (token: string) =>
  postJson("/auth/verify-email", { token });

export const resendVerificationApi = () => postJson("/auth/resend-verification");

// ============================================
// COMPANY INVITATIONS
// ============================================
export const getInvitationApi = async (token: string) => {
  const res = await authFetch(`/invitations/${encodeURIComponent(token)}`);
  const data = await readJson(res);
  if (!res.ok) throw new Error(data.message || "Invitation not found");
  return data.data as {
    email: string;
    role: string;
    hasAccount: boolean;
    company: { id: number; name: string; slug: string };
  };
};

export const acceptInvitationApi = (
  token: string,
  body: { password?: string; firstName?: string; lastName?: string } = {},
) => postJson(`/invitations/${encodeURIComponent(token)}/accept`, body);
