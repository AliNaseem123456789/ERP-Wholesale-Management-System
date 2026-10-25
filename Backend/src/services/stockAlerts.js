// Back-in-stock alerts: a customer asks to be told when a product (variant) can be ordered again.
// The scheduler checks waiting alerts every minute; each alert notifies once (email + bell).
const prisma = require("../prisma");
const inv = require("./inventory");
const { publicWhere, withStock } = require("./catalog");
const { queueEmail } = require("./email/outbox");

const checkAlerts = async () => {
  const waiting = await prisma.stock_alerts.findMany({
    where: { notified_at: null },
    take: 500,
    include: {
      users: { select: { id: true, email: true, role: true } },
      products: { select: { id: true, title: true, slug: true, flavors: true, company_id: true, allow_preorder: true, companies: { select: { id: true } } } },
    },
  });
  let sent = 0;
  for (const a of waiting) {
    const viewer = { user: { id: String(a.user_id), role: a.users.role } };
    const visible = await prisma.products.count({ where: { ...publicWhere(viewer), id: a.product_id } });
    if (!visible) continue;
    const [p] = await withStock(viewer, [{ ...a.products, company: a.products.companies }]);
    const ready = p.stock_status === null
      || (inv.hasFlavors(p) && a.flavor ? (p.flavor_stock?.[a.flavor] ?? 0) > 0 : (p.available ?? 0) > 0);
    if (!ready) continue;
    // claim it (another instance may be sending the same alert)
    const claimed = await prisma.stock_alerts.updateMany({ where: { id: a.id, notified_at: null }, data: { notified_at: new Date() } });
    if (!claimed.count) continue;
    const name = inv.label(a.products.title, a.flavor);
    await queueEmail({
      to: a.users.email, template: "notice",
      data: { type: "stock.back", title: `Back in stock: ${name}`, lines: [`${name} can be ordered again.`], link: `/product/${a.products.slug || a.products.id}`, linkLabel: "Order now" },
    });
    sent++;
  }
  return sent;
};

module.exports = { checkAlerts };
