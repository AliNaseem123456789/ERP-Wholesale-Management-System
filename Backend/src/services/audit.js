const prisma = require("../prisma");

// Records who did what. Never throws (an audit failure must not break the action).
const audit = (req, action, { entity, entityId, changes, companyId } = {}) =>
  prisma.audit_logs
    .create({
      data: {
        company_id: companyId != null ? BigInt(companyId) : req.company ? req.company.id : null,
        user_id: req.user ? BigInt(req.user.id) : null,
        action,
        entity: entity || null,
        entity_id: entityId != null ? String(entityId) : null,
        changes: changes === undefined ? undefined : JSON.parse(JSON.stringify(changes)),
        ip_address: req.ip ? String(req.ip).slice(0, 64) : null,
      },
    })
    .catch((err) => console.error("audit log failed:", err.message));

module.exports = { audit };
