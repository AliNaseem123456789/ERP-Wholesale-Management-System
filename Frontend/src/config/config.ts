// API base URL.
// - Leave VITE_API_BASE_URL empty (default) to call the API on the same origin:
//   in dev, Vite proxies /api -> http://localhost:5000 (see vite.config.ts);
//   on Vercel, vercel.json rewrites /api -> the Render backend.
//   Same-origin requests keep the auth cookies first-party, so login works in
//   Safari and in browsers that block third-party cookies.
// - Set it to a full URL (e.g. https://my-backend.onrender.com) only if you
//   really want the browser to call the backend directly.
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
export const API_PREFIX = "/api";
export const API_URL = `${API_BASE_URL}${API_PREFIX}`;

export const CHATBOT_URL =
  import.meta.env.VITE_CHATBOT_URL ||
  "https://chatbot-gateway-production-bd16.up.railway.app";

// Public Supabase Storage URL (used only to build public image URLs).
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://puwqurkjqembiliyjwqk.supabase.co";
