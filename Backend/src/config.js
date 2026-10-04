// Loads .env once and exposes typed config. Import this before anything else.
require("dotenv").config();

const required = ["DATABASE_URL", "JWT_SECRET"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
}

const isProd = process.env.NODE_ENV === "production" || !!process.env.RENDER;

module.exports = {
  isProd,
  port: Number(process.env.PORT) || 5000,
  jwtSecret: process.env.JWT_SECRET,
  // Falls back to a derived value so existing deployments keep working,
  // but you should set JWT_REFRESH_SECRET explicitly.
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || `${process.env.JWT_SECRET}:refresh`,
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || "15m",
  refreshTokenTtl: process.env.REFRESH_TOKEN_TTL || "30d",
  corsOrigins: (process.env.CORS_ORIGINS ||
    "http://localhost:5173,https://smoke-wholesale.vercel.app")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  shippingFee: Number(process.env.SHIPPING_FEE ?? 10),
  // Public URL of the frontend, used to build links in emails.
  appUrl: (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, ""),
  appName: process.env.APP_NAME || "Smoke Wholesale",
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT) || 587,
    // true for port 465 (implicit TLS), false for 587 (STARTTLS)
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : Number(process.env.SMTP_PORT) === 465,
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.EMAIL_FROM || process.env.SMTP_USER || "no-reply@localhost",
  },
  // Background email worker (set EMAIL_WORKER=false to disable, e.g. on extra instances)
  emailWorkerEnabled: process.env.EMAIL_WORKER !== "false",
  // Requests per 15 minutes per IP on login/register/password endpoints
  authRateLimit: Number(process.env.AUTH_RATE_LIMIT) || 30,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
};
