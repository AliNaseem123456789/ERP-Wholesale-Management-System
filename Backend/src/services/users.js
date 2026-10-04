const prisma = require("../prisma");

// sub_accounts.permissions is a TEXT column holding JSON, e.g. '{"can_place_order": true}'.
const parsePermissions = (raw) => {
  if (!raw) return { can_place_order: false };
  if (typeof raw === "object") return { can_place_order: !!raw.can_place_order };
  try {
    const parsed = JSON.parse(raw);
    return { can_place_order: !!parsed?.can_place_order };
  } catch {
    return { can_place_order: false };
  }
};

const serializePermissions = (perms) =>
  JSON.stringify({ can_place_order: !!perms?.can_place_order });

// Sub-account permissions live in the sub_accounts table (one row per sub-account user).
const getPermissions = async (user) => {
  if (user.role !== "SUBACCOUNT") return null;
  const sub = await prisma.sub_accounts.findUnique({
    where: { user_id: BigInt(user.id) },
    select: { permissions: true },
  });
  return parsePermissions(sub?.permissions);
};

// Companies this user works for (back-office access).
const getMemberships = async (userId) => {
  const rows = await prisma.company_members.findMany({
    where: { user_id: BigInt(userId), status: "active", companies: { status: { not: "suspended" } } },
    select: {
      role: true,
      companies: { select: { id: true, name: true, slug: true, status: true, logo_url: true } },
    },
    orderBy: { created_at: "asc" },
  });
  return rows.map((m) => ({
    companyId: m.companies.id.toString(),
    name: m.companies.name,
    slug: m.companies.slug,
    status: m.companies.status,
    logoUrl: m.companies.logo_url,
    role: m.role,
  }));
};

// Public shape of a user sent to the frontend (never includes password_hash).
const toPublicUser = (user, permissions = null, companies = undefined) => ({
  id: user.id.toString(),
  email: user.email,
  role: user.role,
  isPlatformAdmin: user.role === "ADMIN",
  emailVerified: !!user.email_verified,
  firstName: user.first_name ?? null,
  lastName: user.last_name ?? null,
  businessName: user.business_name ?? null,
  phone: user.phone ?? null,
  permissions,
  ...(companies !== undefined ? { companies } : {}),
});

// Full profile for /auth/me and login responses.
const buildSessionUser = async (user) =>
  toPublicUser(user, await getPermissions(user), await getMemberships(user.id));

const displayName = (user) =>
  [user.first_name, user.last_name].filter(Boolean).join(" ") || user.business_name || null;

module.exports = {
  getPermissions,
  getMemberships,
  toPublicUser,
  buildSessionUser,
  displayName,
  parsePermissions,
  serializePermissions,
};
