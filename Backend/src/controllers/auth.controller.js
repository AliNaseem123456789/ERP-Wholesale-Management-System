const bcrypt = require("bcrypt");
const prisma = require("../prisma");
const {
  setAuthCookies,
  clearAuthCookies,
  findValidRefreshToken,
  retireRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  pruneExpiredTokens,
  REFRESH_COOKIE,
} = require("../jwt");
const { buildSessionUser, toPublicUser, displayName } = require("../services/users");
const { createUserToken, consumeUserToken } = require("../services/tokens");
const { queueEmail } = require("../services/email/outbox");
const { HttpError } = require("../utils/http");

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const assertPasswordStrength = (password) => {
  if (!password || String(password).length < 8) {
    throw new HttpError(400, "Password must be at least 8 characters");
  }
  if (String(password).length > 128) throw new HttpError(400, "Password is too long");
};

const findUserByEmail = (email) =>
  prisma.users.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });

const sendVerificationEmail = async (user) => {
  const token = await createUserToken(user.id, "email_verify");
  await queueEmail({ to: user.email, template: "verifyEmail", data: { name: displayName(user), token } });
};

const login = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const { password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password required" });
  }

  const user = await findUserByEmail(email);
  if (!user || !(await bcrypt.compare(String(password), user.password_hash))) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  await prisma.users.update({ where: { id: user.id }, data: { last_login: new Date() } });
  await pruneExpiredTokens(user.id);

  await setAuthCookies(res, user, req);
  res.status(200).json({ message: "Login successful", user: await buildSessionUser(user) });
};

const register = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const { password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password required" });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ message: "Please enter a valid email" });
  }
  assertPasswordStrength(password);

  if (await findUserByEmail(email)) return res.status(409).json({ message: "User already exists" });

  const user = await prisma.users.create({
    data: {
      email,
      password_hash: await bcrypt.hash(password, 10),
      role: "USER",
      first_name: req.body.firstName ? String(req.body.firstName).trim() : null,
      last_name: req.body.lastName ? String(req.body.lastName).trim() : null,
      business_name: req.body.businessName ? String(req.body.businessName).trim() : null,
    },
  });

  await sendVerificationEmail(user);
  await setAuthCookies(res, user, req);
  res.status(201).json({
    message: "User registered successfully. Check your email to verify your address.",
    user: await buildSessionUser(user),
  });
};

const me = async (req, res) => {
  const user = await prisma.users.findUnique({ where: { id: BigInt(req.user.id) } });
  if (!user) return res.status(404).json({ message: "User not found" });
  res.status(200).json({ user: await buildSessionUser(user) });
};

// Issues a fresh access cookie and rotates the refresh cookie.
const refresh = async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  const session = await findValidRefreshToken(token);
  if (!session) {
    clearAuthCookies(res);
    return res.status(401).json({ message: "Session expired, please log in again" });
  }

  const user = await prisma.users.findUnique({ where: { id: session.user_id } });
  if (!user) {
    clearAuthCookies(res);
    return res.status(401).json({ message: "Session expired, please log in again" });
  }

  await retireRefreshToken(session);
  await setAuthCookies(res, user, req);
  res.status(200).json({ message: "Token refreshed" });
};

const logout = async (req, res) => {
  await revokeRefreshToken(req.cookies?.[REFRESH_COOKIE]);
  clearAuthCookies(res);
  res.status(200).json({ message: "Logged out successfully" });
};

// Revokes every session of this user. Other devices are signed out as soon as
// their current access token (max ACCESS_TOKEN_TTL, default 15 min) expires.
const logoutAll = async (req, res) => {
  const devicesLoggedOut = await revokeAllForUser(req.user.id);
  clearAuthCookies(res);
  res.status(200).json({ message: "Logged out from all devices", success: true, devicesLoggedOut });
};

// ---- password reset ----------------------------------------------------------

const GENERIC_RESET_MESSAGE =
  "If an account exists for that email, we've sent a link to reset the password.";

const forgotPassword = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!EMAIL_RE.test(email)) throw new HttpError(400, "Please enter a valid email");

  const user = await findUserByEmail(email);
  if (user) {
    const token = await createUserToken(user.id, "password_reset");
    await queueEmail({ to: user.email, template: "passwordReset", data: { name: displayName(user), token } });
  }
  // Same answer either way, so the endpoint can't be used to discover who has an account.
  res.status(200).json({ message: GENERIC_RESET_MESSAGE });
};

const resetPassword = async (req, res) => {
  const { token, password } = req.body;
  assertPasswordStrength(password);

  const row = await consumeUserToken(token, "password_reset");
  if (!row) throw new HttpError(400, "This reset link is invalid or has expired. Please request a new one.");

  const user = await prisma.users.update({
    where: { id: row.user_id },
    // Receiving the email proves ownership of the address, so it also counts as verification.
    data: { password_hash: await bcrypt.hash(String(password), 10), email_verified: true, updated_at: new Date() },
  });
  await revokeAllForUser(user.id);
  await queueEmail({ to: user.email, template: "passwordChanged", data: { name: displayName(user) } });

  clearAuthCookies(res);
  res.status(200).json({ message: "Password updated. You can now log in with your new password." });
};

const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  assertPasswordStrength(newPassword);

  const user = await prisma.users.findUnique({ where: { id: BigInt(req.user.id) } });
  if (!user || !(await bcrypt.compare(String(currentPassword || ""), user.password_hash))) {
    throw new HttpError(400, "Your current password is incorrect");
  }
  if (await bcrypt.compare(String(newPassword), user.password_hash)) {
    throw new HttpError(400, "The new password must be different from the current one");
  }

  await prisma.users.update({
    where: { id: user.id },
    data: { password_hash: await bcrypt.hash(String(newPassword), 10), updated_at: new Date() },
  });
  // Sign out everywhere else, keep this device signed in.
  await revokeAllForUser(user.id);
  await setAuthCookies(res, user, req);
  await queueEmail({ to: user.email, template: "passwordChanged", data: { name: displayName(user) } });

  res.status(200).json({ message: "Password changed. Other devices have been signed out." });
};

// ---- email verification --------------------------------------------------------

const verifyEmail = async (req, res) => {
  const row = await consumeUserToken(req.body.token, "email_verify");
  if (!row) throw new HttpError(400, "This verification link is invalid or has expired.");
  const user = await prisma.users.update({
    where: { id: row.user_id },
    data: { email_verified: true, updated_at: new Date() },
  });
  res.status(200).json({ message: "Email verified. Thank you!", user: toPublicUser(user) });
};

const resendVerification = async (req, res) => {
  const user = await prisma.users.findUnique({ where: { id: BigInt(req.user.id) } });
  if (!user) throw new HttpError(404, "User not found");
  if (user.email_verified) return res.status(200).json({ message: "Your email is already verified." });
  await sendVerificationEmail(user);
  res.status(200).json({ message: `Verification email sent to ${user.email}.` });
};

module.exports = {
  login,
  register,
  me,
  refresh,
  logout,
  logoutAll,
  forgotPassword,
  resetPassword,
  changePassword,
  verifyEmail,
  resendVerification,
};
