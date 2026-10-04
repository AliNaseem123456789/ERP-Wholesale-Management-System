// Sends an email to the staff of a company who hold a given permission
// (plus the company's own contact address).
const prisma = require("../prisma");
const { can } = require("./permissions");
const { queueEmail } = require("./email/outbox");

const notifyCompany = async (companyId, permission, { template, data }) => {
  try {
    const company = await prisma.companies.findUnique({
      where: { id: BigInt(companyId) },
      select: {
        email: true,
        company_members: {
          where: { status: "active" },
          select: { role: true, users: { select: { email: true } } },
        },
      },
    });
    if (!company) return;
    const recipients = new Set(
      company.company_members.filter((m) => can(m.role, permission)).map((m) => m.users.email.toLowerCase()),
    );
    if (company.email) recipients.add(company.email.toLowerCase());
    for (const to of recipients) {
      await queueEmail({ to, template, data, companyId });
    }
  } catch (err) {
    console.error("notifyCompany failed:", err.message);
  }
};

module.exports = { notifyCompany };
