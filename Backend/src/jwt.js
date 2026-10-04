// Authentication helpers: issuing tokens, cookies, and route middleware.
//
// Two httpOnly cookies are used:
//   accessToken  - signed JWT, short lived (ACCESS_TOKEN_TTL, default 15m), sent on every request
//   refreshToken - random opaque token (REFRESH_TOKEN_TTL, default 30d). Only its SHA-256 hash is
//                  stored, in the existing `refresh_tokens` table, so sessions can be revoked
//                  (logout, "log out of all devices").
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const prisma = require("./prisma");
const { isProd, jwtSecret, accessTokenTtl, refreshTokenTtl } = require("./config");

const ACCESS_COOKIE = "accessToken";
const REFRESH_COOKIE = "refreshToken";
// Two tabs refreshing at the same moment both present the same token; allow that briefly.
const ROTATION_GRACE_MS = 30 * 1000;

const ttlToMs = (ttl) => {
  const m = /^(\d+)\s*([smhd])$/.exec(String(ttl).trim());
  if (!m) return Number(ttl) * 1000;
  return Number(m[1]) * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2]];
};

const cookieOptions = (maxAge) => ({
  httpOnly: true,
  // If the site and API end up on different domains, SameSite=None + Secure is required.
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
  path: "/",
  maxAge,
});

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
const clip = (v, n = 255) => (v ? String(v).slice(0, n) : null);

// ---- issuing ---------------------------------------------------------------
const generateAccessToken = (user) =>
  jwt.sign(
    { sub: user.id.toString(), email: user.email, role: user.role },
    jwtSecret,
    { expiresIn: accessTokenTtl },
  );

const createRefreshToken = async (user, req) => {
  const token = crypto.randomBytes(48).toString("hex");
  await prisma.refresh_tokens.create({
    data: {
      token: hashToken(token),
      user_id: BigInt(user.id),
      expires_at: new Date(Date.now() + ttlToMs(refreshTokenTtl)),
      user_agent: clip(req?.headers?.["user-agent"]),
      ip_address: clip(req?.ip),
    },
  });
  return token;
};

// Sets both cookies. Pass `req` so the device / IP is recorded with the session.
const setAuthCookies = async (res, user, req) => {
  const refreshToken = await createRefreshToken(user, req);
  res.cookie(ACCESS_COOKIE, generateAccessToken(user), cookieOptions(ttlToMs(accessTokenTtl)));
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions(ttlToMs(refreshTokenTtl)));
};

const clearAuthCookies = (res) => {
  const { maxAge, ...opts } = cookieOptions(0);
  res.clearCookie(ACCESS_COOKIE, opts);
  res.clearCookie(REFRESH_COOKIE, opts);
};

// Returns the session row for a refresh cookie if it is still usable, else null.
const findValidRefreshToken = async (token) => {
  if (!token) return null;
  const row = await prisma.refresh_tokens.findUnique({ where: { token: hashToken(token) } });
  if (!row || row.revoked || row.expires_at < new Date()) return null;
  return row;
};

// After a refresh the old token is not revoked outright: it just expires within
// ROTATION_GRACE_MS, so a second tab refreshing at the same moment isn't logged out.
const retireRefreshToken = async (row) => {
  const graceEnd = new Date(Date.now() + ROTATION_GRACE_MS);
  if (row.expires_at > graceEnd) {
    await prisma.refresh_tokens.update({ where: { id: row.id }, data: { expires_at: graceEnd } });
  }
};

const revokeRefreshToken = async (token) => {
  if (!token) return;
  await prisma.refresh_tokens.updateMany({
    where: { token: hashToken(token), revoked: { not: true } },
    data: { revoked: true, revoked_at: new Date() },
  });
};

const revokeAllForUser = async (userId) => {
  const { count } = await prisma.refresh_tokens.updateMany({
    where: { user_id: BigInt(userId), revoked: { not: true }, expires_at: { gt: new Date() } },
    data: { revoked: true, revoked_at: new Date() },
  });
  return count;
};

// Housekeeping: drop this user's expired sessions (called on login).
const pruneExpiredTokens = (userId) =>
  prisma.refresh_tokens
    .deleteMany({ where: { user_id: BigInt(userId), expires_at: { lt: new Date() } } })
    .catch(() => {});

// ---- middleware ------------------------------------------------------------
const decodeAccess = (token) => {
  const decoded = jwt.verify(token, jwtSecret);
  return { id: decoded.sub, sub: decoded.sub, email: decoded.email, role: decoded.role };
};

// Requires a valid access cookie (401 otherwise, which makes the frontend call /auth/refresh).
const verifyTokenFromCookie = (req, res, next) => {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (!token) return res.status(401).json({ message: "Not authenticated" });
  try {
    req.user = decodeAccess(token);
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

// For public routes that show extra data (prices) to logged-in users.
// An expired cookie returns 401 so the frontend can refresh and retry.
const optionalAuth = (req, res, next) => {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (!token) return next();
  try {
    req.user = decodeAccess(token);
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

module.exports = {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  generateAccessToken,
  setAuthCookies,
  clearAuthCookies,
  findValidRefreshToken,
  retireRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  pruneExpiredTokens,
  verifyTokenFromCookie,
  requireAuth: verifyTokenFromCookie,
  optionalAuth,
};
