// Resolves the company (tenant) a back-office request acts on.
//   - The company id comes from the `X-Company-Id` header.
//   - The user must be an active member of it (platform admins may act on any company).
//   - Sets req.company, req.membership ({ role, permissions }) and req.can(permission).
const prisma = require("../prisma");
const { can, permissionsFor } = require("../services/permissions");

const companyContext = async (req, res, next) => {
  const raw = req.get("x-company-id");
  if (!raw || !/^\d+$/.test(raw)) {
    return res.status(400).json({ message: "Select a company first (X-Company-Id header missing)" });
  }
  const companyId = BigInt(raw);
  const company = await prisma.companies.findUnique({ where: { id: companyId } });
  if (!company) return res.status(404).json({ message: "Company not found" });

  const isPlatformAdmin = req.user.role === "ADMIN";
  let role = null;
  if (isPlatformAdmin) {
    role = "OWNER";
  } else {
    const member = await prisma.company_members.findUnique({
      where: { company_id_user_id: { company_id: companyId, user_id: BigInt(req.user.id) } },
    });
    if (!member || member.status !== "active") {
      return res.status(403).json({ message: "You are not a member of this company" });
    }
    role = member.role;
  }

  if (company.status === "suspended" && !isPlatformAdmin) {
    return res.status(403).json({ message: "This company is suspended. Contact the platform administrator." });
  }

  req.company = company;
  req.membership = { role, permissions: permissionsFor(role), isPlatformAdmin };
  req.can = (permission) => can(role, permission);
  next();
};

// Route guard: requirePermission("products.manage")
const requirePermission = (...permissions) => (req, res, next) => {
  if (permissions.some((p) => req.can?.(p))) return next();
  return res.status(403).json({ message: "You don't have permission to do this" });
};

module.exports = { companyContext, requirePermission };
