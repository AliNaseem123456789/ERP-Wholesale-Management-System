const bcrypt = require("bcrypt");
const prisma = require("../prisma");
const { HttpError, toId } = require("../utils/http");
const {
  buildSessionUser,
  parsePermissions,
  serializePermissions,
} = require("../services/users");

const optionalText = (v) => (v === undefined ? undefined : String(v).trim() || null);

const updateProfile = async (req, res) => {
  const { firstName, lastName, businessName, phone } = req.body;
  const updated = await prisma.users.update({
    where: { id: BigInt(req.user.id) },
    data: {
      first_name: optionalText(firstName),
      last_name: optionalText(lastName),
      business_name: optionalText(businessName),
      phone: optionalText(phone),
      updated_at: new Date(),
    },
  });
  res.status(200).json({
    message: "Profile updated successfully",
    user: await buildSessionUser(updated),
  });
};

const assertOwner = (req) => {
  if (req.user.role === "SUBACCOUNT") {
    throw new HttpError(403, "Sub-accounts can't manage team members");
  }
};

const addSubAccount = async (req, res) => {
  assertOwner(req);
  const ownerId = BigInt(req.user.id);
  const email = String(req.body.email || "").trim().toLowerCase();
  const { password, firstName, lastName } = req.body;
  const canPlaceOrder = req.body.canPlaceOrder ?? req.body.can_place_order ?? true;

  if (!email || !password) throw new HttpError(400, "Email and password are required");
  if (String(password).length < 8) throw new HttpError(400, "Password must be at least 8 characters");

  const existing = await prisma.users.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) throw new HttpError(409, "A user with this email already exists");

  const passwordHash = await bcrypt.hash(password, 10);

  // Both rows are created together, or neither is.
  await prisma.$transaction(async (tx) => {
    const user = await tx.users.create({
      data: {
        email,
        password_hash: passwordHash,
        first_name: optionalText(firstName),
        last_name: optionalText(lastName),
        role: "SUBACCOUNT",
        parent_id: ownerId,
      },
    });
    await tx.sub_accounts.create({
      data: {
        user_id: user.id,
        parent_id: ownerId,
        permissions: serializePermissions({ can_place_order: canPlaceOrder }),
      },
    });
  });

  res.status(201).json({ message: "Subaccount created successfully" });
};

const getMySubAccounts = async (req, res) => {
  const subs = await prisma.sub_accounts.findMany({
    where: { parent_id: BigInt(req.user.id) },
    orderBy: { id: "asc" },
  });
  const users = await prisma.users.findMany({
    where: { id: { in: subs.map((s) => s.user_id).filter(Boolean) } },
    select: { id: true, email: true, first_name: true, last_name: true, created_at: true },
  });
  const byId = new Map(users.map((u) => [u.id.toString(), u]));

  const data = subs.map((s) => ({
    id: s.id,
    permissions: parsePermissions(s.permissions),
    users: byId.get(String(s.user_id)) ?? null,
  }));
  res.status(200).json({ data });
};

const updateSubAccountPermission = async (req, res) => {
  assertOwner(req);
  const id = toId(req.body.subAccountId, "subAccountId");
  const result = await prisma.sub_accounts.updateMany({
    where: { id, parent_id: BigInt(req.user.id) },
    data: {
      permissions: serializePermissions({ can_place_order: req.body.canPlaceOrder }),
      updated_at: new Date(),
    },
  });
  if (!result.count) throw new HttpError(404, "Team member not found");
  res.json({ message: "Permissions updated" });
};

const getMyCreditHistory = async (req, res) => {
  const data = await prisma.credit_history.findMany({
    where: { user_id: BigInt(req.user.id) },
    orderBy: { created_at: "desc" },
  });
  res.status(200).json(data);
};

module.exports = {
  updateProfile,
  getMySubAccounts,
  updateSubAccountPermission,
  addSubAccount,
  getMyCreditHistory,
};
