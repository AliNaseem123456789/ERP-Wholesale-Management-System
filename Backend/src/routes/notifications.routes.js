// The signed-in user's notifications centre (the bell).
const express = require("express");
const prisma = require("../prisma");
const { verifyTokenFromCookie } = require("../jwt");
const { toId } = require("../utils/http");

const router = express.Router();
router.use(verifyTokenFromCookie);

// GET /api/notifications?unread=1&page=1
router.get("/", async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const where = { user_id: BigInt(req.user.id), ...(req.query.unread === "1" ? { read_at: null } : {}), ...(req.query.type ? { type: { startsWith: String(req.query.type) } } : {}) };
  const [rows, total, unread] = await Promise.all([
    prisma.notifications.findMany({ where, orderBy: { id: "desc" }, skip: (page - 1) * limit, take: limit }),
    prisma.notifications.count({ where }),
    prisma.notifications.count({ where: { user_id: BigInt(req.user.id), read_at: null } }),
  ]);
  const companyIds = [...new Set(rows.map((r) => r.company_id).filter(Boolean))];
  const companies = companyIds.length ? await prisma.companies.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }) : [];
  res.json({
    data: rows.map((r) => ({ ...r, company: companies.find((c) => c.id === r.company_id) || null })),
    unread, totalCount: total, totalPages: Math.ceil(total / limit), currentPage: page,
  });
});

router.get("/count", async (req, res) => {
  res.json({ unread: await prisma.notifications.count({ where: { user_id: BigInt(req.user.id), read_at: null } }) });
});

router.post("/read-all", async (req, res) => {
  const r = await prisma.notifications.updateMany({ where: { user_id: BigInt(req.user.id), read_at: null }, data: { read_at: new Date() } });
  res.json({ message: `${r.count} marked as read` });
});

router.post("/:id/read", async (req, res) => {
  await prisma.notifications.updateMany({ where: { id: toId(req.params.id), user_id: BigInt(req.user.id), read_at: null }, data: { read_at: new Date() } });
  res.json({ message: "Marked as read" });
});

// DELETE /api/notifications/read -> clears notifications already read
router.delete("/read", async (req, res) => {
  const r = await prisma.notifications.deleteMany({ where: { user_id: BigInt(req.user.id), read_at: { not: null } } });
  res.json({ message: `${r.count} cleared` });
});

router.delete("/:id", async (req, res) => {
  await prisma.notifications.deleteMany({ where: { id: toId(req.params.id), user_id: BigInt(req.user.id) } });
  res.json({ message: "Removed" });
});

module.exports = router;
