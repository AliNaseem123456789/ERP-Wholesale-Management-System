// Company roles and what they may do. "*" = everything, "orders.*" = every orders permission.
// Later phases (inventory, purchasing, accounting, hr, payroll) already have their roles mapped.
const ROLES = ["OWNER", "MANAGER", "ACCOUNTANT", "WAREHOUSE", "SALES", "HR"];

const ROLE_PERMISSIONS = {
  OWNER: ["*"],
  MANAGER: [
    "company.view", "dashboard.view", "members.view", "members.manage",
    "products.*", "orders.*", "customers.*", "pricing.*", "sales.*", "quotes.*", "invoices.*", "returns.*",
    "inventory.*", "purchasing.*", "accounting.view", "hr.view", "hr.attendance", "hr.leave", "reports.view", "audit.view",
  ],
  ACCOUNTANT: [
    "company.view", "dashboard.view", "orders.view", "customers.*", "pricing.view", "products.view",
    "quotes.view", "invoices.*", "returns.view", "inventory.view", "purchasing.view",
    "accounting.*", "reports.view", "payroll.view", "payroll.pay", "audit.view",
  ],
  WAREHOUSE: [
    "company.view", "dashboard.view", "products.view", "orders.view", "orders.fulfil",
    "inventory.*", "purchasing.view", "purchasing.receive", "returns.view", "returns.receive",
  ],
  SALES: [
    "company.view", "dashboard.view", "products.view", "orders.view", "orders.manage",
    "customers.*", "pricing.*", "quotes.*", "invoices.view", "returns.view", "returns.manage", "inventory.view", "reports.view",
  ],
  HR: ["company.view", "dashboard.view", "members.view", "hr.*", "payroll.*"],
};

// Human-readable list for the UI.
const ROLE_DESCRIPTIONS = {
  OWNER: "Full access, including billing, team and company settings",
  MANAGER: "Runs day-to-day operations: products, orders, sales, team, inventory, purchasing, attendance and leave approvals",
  ACCOUNTANT: "Bookkeeping: invoices, payments, supplier bills, expenses, journal, bank reconciliation and financial reports",
  WAREHOUSE: "Stock, receiving, order fulfilment and receiving returns",
  SALES: "Customers, pricing, promotions, quotes, orders and returns",
  HR: "Employees, departments, attendance, leave and payroll (salaries, payslips)",
};

const can = (role, permission) => {
  const perms = ROLE_PERMISSIONS[role] || [];
  const [area] = permission.split(".");
  return perms.includes("*") || perms.includes(permission) || perms.includes(`${area}.*`);
};

const permissionsFor = (role) => ROLE_PERMISSIONS[role] || [];

module.exports = { ROLES, ROLE_PERMISSIONS, ROLE_DESCRIPTIONS, can, permissionsFor };
