// One-time tokens (password reset, email verification, invitations).
// Only the SHA-256 hash is stored; the raw token only ever exists in the emailed link.
const crypto = require("crypto");
const prisma = require("../prisma");

const newToken = () => crypto.randomBytes(32).toString("base64url");
const hashToken = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");

const TTL = {
  password_reset: 60 * 60 * 1000, // 1 hour
  email_verify: 48 * 60 * 60 * 1000, // 48 hours
};

// Creates a token for the user, invalidating earlier unused tokens of the same type.
const createUserToken = async (userId, type) => {
  const token = newToken();
  await prisma.$transaction([
    prisma.user_tokens.updateMany({
      where: { user_id: BigInt(userId), type, used_at: null },
      data: { used_at: new Date() },
    }),
    prisma.user_tokens.create({
      data: {
        user_id: BigInt(userId),
        type,
        token_hash: hashToken(token),
        expires_at: new Date(Date.now() + TTL[type]),
      },
    }),
  ]);
  return token;
};

// Atomically marks a token as used. Returns the token row, or null if invalid/expired/used.
const consumeUserToken = async (token, type, db = prisma) => {
  if (!token) return null;
  const token_hash = hashToken(token);
  const { count } = await db.user_tokens.updateMany({
    where: { token_hash, type, used_at: null, expires_at: { gt: new Date() } },
    data: { used_at: new Date() },
  });
  if (!count) return null;
  return db.user_tokens.findUnique({ where: { token_hash } });
};

module.exports = { newToken, hashToken, createUserToken, consumeUserToken };
