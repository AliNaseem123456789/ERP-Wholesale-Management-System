// Public demo logins (filled by `npm run demo:data` in Backend). Anyone visiting the site can sign in with
// these to try the ERP. They are made-up people at made-up companies (example.com addresses never receive mail).
export const DEMO_PASSWORD = "DemoPass2026!";

export type DemoAccount = {
  email: string;
  name: string;
  role: string;
  /** what this login is good for, shown under the name */
  shows: string;
  /** where to go after signing in */
  home: string;
};

export const DEMO_SELLER: DemoAccount = {
  email: "demo@meridian-trade.example.com",
  name: "Meridian Trade Supply",
  role: "Seller · owner",
  shows: "The whole ERP: orders, stock, purchasing, invoices, HR & payroll, reports",
  home: "/business",
};

export const DEMO_ACCOUNTS: DemoAccount[] = [
  DEMO_SELLER,
  {
    email: "demo@corner-market.example.com",
    name: "Corner Market",
    role: "Buyer",
    shows: "The marketplace as a shop owner: trade prices, quotes, orders, reorders",
    home: "/",
  },
  { email: "priya.shah@meridian-trade.example.com", name: "Priya Shah", role: "Operations manager", shows: "Day-to-day operations across the business", home: "/business" },
  { email: "marcus.bell@meridian-trade.example.com", name: "Marcus Bell", role: "Accountant", shows: "Invoices, payments, expenses and financial reports", home: "/business" },
  { email: "olivia.grant@meridian-trade.example.com", name: "Olivia Grant", role: "HR & payroll", shows: "Employees, leave, attendance and payroll", home: "/business" },
  { email: "ethan.cole@meridian-trade.example.com", name: "Ethan Cole", role: "Warehouse", shows: "Stock, receiving, picking and transfers", home: "/business" },
  { email: "sofia.martinez@meridian-trade.example.com", name: "Sofia Martinez", role: "Sales", shows: "Customers, quotes and sales orders", home: "/business" },
];

export const demoAccountFor = (email: string) =>
  DEMO_ACCOUNTS.find((a) => a.email.toLowerCase() === email.trim().toLowerCase());
