// frontend/src/api/apiClient.ts
import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { API_URL } from "../config/config";
import { refreshAccessToken } from "../features/auth/api/auth.api";

export const apiClient = axios.create({
  baseURL: API_URL,
  withCredentials: true,
});

// Share one in-flight refresh between all requests that hit a 401 at once.
let refreshPromise: Promise<boolean> | null = null;
const refreshOnce = () => {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
};

// `_public` marks catalogue requests that also work logged-out: if the session
// cannot be refreshed we simply retry them anonymously instead of redirecting.
type RetriableConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
  _public?: boolean;
};

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetriableConfig | undefined;
    const isAuthCall = originalRequest?.url?.includes("/auth/");

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !isAuthCall
    ) {
      originalRequest._retry = true;
      const refreshed = await refreshOnce();
      if (refreshed || originalRequest._public) return apiClient(originalRequest);

      // Session is really gone: send the user to login (once).
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }

    return Promise.reject(error);
  },
);
