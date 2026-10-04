// Company staff: members, roles and email invitations.
const bcrypt = require("bcrypt");
const prisma = require("../../prisma");
const { HttpError, toId } = require("../../utils/http");
const { ROLES } = require("../../services/permissions");
const { newToken, hashToken } = require("../../services/tokens");
const { queueEmail } = require("../../services/email/outbox");
const { displayName, buildSessionUser } = require("../../services/users");
const { audit } = require("../../services/audit");
const { setAuthCookies } = require("../../jwt");

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const normalizeEmail = (e) => String(e || "").trim().toLowerCase();

const assertRole = (role) => {
  if (!ROLES.includes(role)) throw new HttpError(400, `Role must be one of: ${ROLES.join(", ")}`);
};
// Only owners can create other owners.
const assertCanGrant = (req, role) => {
  if (role === "OWNER" && req.membership.role !== "OWNER") {
    throw new HttpError(403, "Only an owner can make someone an owner");
  }
};

const activeOwnerCount = (companyId) =>
  prisma.company_members.count({ where: { company_id: companyId, role: "OWNER", status: "active" } });

// GET /company/members
const listMembers = async (req, res) => {
  const [members, invitations] = await Promise.all([
    prisma.company_members.findMany({
      where: { company_id: req.company.id },
      orderBy: { created_at: "asc" },
      include: { users: { select: { id: true, email: true, first_name: true, last_name: true, last_login: true } } },
    }),
    req.can("members.manage")
      ? prisma.company_invitations.findMany({
          where: { company_id: req.company.id, accepted_at: null, revoked_at: null, expires_at: { gt: new Date() } },
          orderBy: { created_at: "desc" },
          select: { id: true, email: true, role: true, expires_at: true, created_at: true },
        })
      : [],
  ]);
  res.json({
    data: members.map(({ users, ...m }) => ({ ...m, user: users })),
    invitations,
  });
};

// PATCH /company/members/:id  { role?, status? }
const updateMember = async (req, res) => {
  const id = toId(req.params.id);
  const member = await prisma.company_members.findFirst({ where: { id, company_id: req.company.id } });
  if (!member) throw new HttpError(404, "Team member not found");

  const data = {};
  if (req.body.role !== undefined) {
    assertRole(req.body.role);
    assertCanGrant(req, req.body.role);
    if (member.role === "OWNER" && req.membership.role !== "OWNER") throw new HttpError(403, "Only an owner can change another owner");
    data.role = req.body.role;
  }
  if (req.body.status !== undefined) {
    if (!["active", "disabled"].includes(req.body.status)) throw new HttpError(400, "Status must be active or disabled");
    data.status = req.body.status;
  }
  const losesOwner = member.role === "OWNER" && member.status === "active" && (data.role && data.role !== "OWNER" || data.status === "disabled");
  if (losesOwner && (await activeOwnerCount(req.company.id)) <= 1) {
    throw new HttpError(400, "A company needs at least one active owner");
  }

  const updated = await prisma.company_members.update({ where: { id }, data: { ...data, updated_at: new Date() } });
  await audit(req, "member.update", { entity: "member", entityId: id, changes: data });
  res.json({ message: "Team member updated", data: updated });
};

// DELETE /company/members/:id
const removeMember = async (req, res) => {
  const id = toId(req.params.id);
  const member = await prisma.company_members.findFirst({ where: { id, company_id: req.company.id } });
  if (!member) throw new HttpError(404, "Team member not found");
  if (member.role === "OWNER") {
    if (req.membership.role !== "OWNER") throw new HttpError(403, "Only an owner can remove an owner");
    if ((await activeOwnerCount(req.company.id)) <= 1) throw new HttpError(400, "A company needs at least one active owner");
  }
  await prisma.company_members.delete({ where: { id } });
  await audit(req, "member.remove", { entity: "member", entityId: id, changes: { user_id: member.user_id } });
  res.json({ message: "Team member removed" });
};

// POST /company/invitations { email, role }
const inviteMember = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const role = req.body.role || "SALES";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Please enter a valid email");
  assertRole(role);
  assertCanGrant(req, role);

  const existingUser = await prisma.users.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } });
  if (existingUser) {
    const already = await prisma.company_members.findUnique({
      where: { company_id_user_id: { company_id: req.company.id, user_id: existingUser.id } },
    });
    if (already) throw new HttpError(409, "This person is already on your team");
  }

  const token = newToken();
  const invitation = await prisma.$transaction(async (tx) => {
    // Replace any earlier pending invite for the same email.
    await tx.company_invitations.updateMany({
      where: { company_id: req.company.id, email, accepted_at: null, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    return tx.company_invitations.create({
      data: {
        company_id: req.company.id,
        email,
        role,
        token_hash: hashToken(token),
        invited_by: BigInt(req.user.id),
        expires_at: new Date(Date.now() + INVITE_TTL_MS),
      },
      select: { id: true, email: true, role: true, expires_at: true, created_at: true },
    });
  });

  const inviter = await prisma.users.findUnique({ where: { id: BigInt(req.user.id) } });
  await queueEmail({
    to: email,
    template: "invitation",
    companyId: req.company.id,
    data: { companyName: req.company.name, role, inviterName: displayName(inviter) || inviter.email, token },
  });
  await audit(req, "member.invite", { entity: "invitation", entityId: invitation.id, changes: { email, role } });
  res.status(201).json({ message: `Invitation sent to ${email}`, data: invitation });
};

// DELETE /company/invitations/:id
const revokeInvitation = async (req, res) => {
  const id = toId(req.params.id);
  const { count } = await prisma.company_invitations.updateMany({
    where: { id, company_id: req.company.id, accepted_at: null, revoked_at: null },
    data: { revoked_at: new Date() },
  });
  if (!count) throw new HttpError(404, "Invitation not found");
  await audit(req, "member.invite_revoke", { entity: "invitation", entityId: id });
  res.json({ message: "Invitation revoked" });
};

// ---- public invitation endpoints (no company context) --------------------------

const findOpenInvitation = async (token) => {
  if (!token) return null;
  return prisma.company_invitations.findFirst({
    where: { token_hash: hashToken(token), accepted_at: null, revoked_at: null, expires_at: { gt: new Date() } },
    include: { companies: { select: { id: true, name: true, slug: true, status: true } } },
  });
};

// GET /invitations/:token
const previewInvitation = async (req, res) => {
  const inv = await findOpenInvitation(req.params.token);
  if (!inv) throw new HttpError(404, "This invitation is invalid, expired or was already used");
  const hasAccount = !!(await prisma.users.findFirst({ where: { email: { equals: inv.email, mode: "insensitive" } }, select: { id: true } }));
  res.json({
    data: { email: inv.email, role: inv.role, company: inv.companies, hasAccount, expiresAt: inv.expires_at },
  });
};

// POST /invitations/:token/accept
//  - logged in as the invited email -> joins the company
//  - no account yet + { password, firstName, lastName } -> creates the account, joins and logs in
const acceptInvitation = async (req, res) => {
  const inv = await findOpenInvitation(req.params.token);
  if (!inv) throw new HttpError(404, "This invitation is invalid, expired or was already used");

  let user = await prisma.users.findFirst({ where: { email: { equals: inv.email, mode: "insensitive" } } });

  if (user) {
    if (!req.user) throw new HttpError(401, "Please log in with the invited email address to accept");
    if (String(user.id) !== String(req.user.id)) {
      throw new HttpError(403, `This invitation is for ${inv.email}. Log in with that account to accept it.`);
    }
  } else {
    const { password, firstName, lastName } = req.body;
    if (!password || String(password).length < 8) throw new HttpError(400, "Choose a password of at least 8 characters");
    user = await prisma.users.create({
      data: {
        email: inv.email,
        password_hash: await bcrypt.hash(String(password), 10),
        role: "USER",
        // They clicked the emailed link, so the address is verified.
        email_verified: true,
        first_name: firstName ? String(firstName).trim() : null,
        last_name: lastName ? String(lastName).trim() : null,
      },
    });
  }

  await prisma.$transaction([
    prisma.company_members.upsert({
      where: { company_id_user_id: { company_id: inv.company_id, user_id: user.id } },
      create: { company_id: inv.company_id, user_id: user.id, role: inv.role },
      update: { role: inv.role, status: "active", updated_at: new Date() },
    }),
    prisma.company_invitations.update({ where: { id: inv.id }, data: { accepted_at: new Date() } }),
    prisma.users.update({ where: { id: user.id }, data: { email_verified: true } }),
  ]);
  await audit({ ...req, user: { id: user.id } }, "member.join", {
    companyId: inv.company_id, entity: "member", entityId: user.id, changes: { role: inv.role },
  });

  if (!req.user) await setAuthCookies(res, user, req);
  res.json({
    message: `You've joined ${inv.companies.name}`,
    company: inv.companies,
    user: await buildSessionUser(await prisma.users.findUnique({ where: { id: user.id } })),
  });
};

module.exports = {
  listMembers,
  updateMember,
  removeMember,
  inviteMember,
  revokeInvitation,
  previewInvitation,
  acceptInvitation,
};
