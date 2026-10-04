const prisma = require("../prisma");

const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "company";

// Finds a free company slug: "acme", "acme-2", "acme-3", ...
const uniqueCompanySlug = async (name, excludeId = null) => {
  const base = slugify(name);
  for (let i = 1; i < 500; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    const existing = await prisma.companies.findUnique({ where: { slug }, select: { id: true } });
    if (!existing || (excludeId && existing.id === BigInt(excludeId))) return slug;
  }
  return `${base}-${Date.now()}`;
};

module.exports = { slugify, uniqueCompanySlug };
