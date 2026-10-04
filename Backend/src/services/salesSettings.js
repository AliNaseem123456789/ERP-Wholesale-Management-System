// Per-company sales settings (stored in companies.settings.sales).
const { shippingFee: envShippingFee } = require("../config");

const DEFAULTS = {
  taxRate: 0,              // % sales tax on (subtotal - discount); 0 = no tax
  shippingFee: null,       // null = platform default (SHIPPING_FEE)
  freeShippingOver: null,  // order subtotal (after discount) that ships free; null = never
  autoInvoice: true,       // create the invoice automatically when an order ships
  invoiceNotes: "",        // printed on every invoice (bank details, terms...)
  quoteValidityDays: 14,
  allowCashOnDelivery: true,
  returnWindowDays: 30,    // customers can request a return this many days after shipping; 0 = no online returns
};

const getSalesSettings = (company) => {
  const s = { ...DEFAULTS, ...(company?.settings?.sales || {}) };
  return {
    ...s,
    taxRate: Number(s.taxRate) || 0,
    returnWindowDays: Number.isFinite(Number(s.returnWindowDays)) ? Number(s.returnWindowDays) : DEFAULTS.returnWindowDays,
    shippingFee: s.shippingFee === null || s.shippingFee === undefined || s.shippingFee === "" ? envShippingFee : Number(s.shippingFee),
    freeShippingOver: s.freeShippingOver === null || s.freeShippingOver === "" || s.freeShippingOver === undefined ? null : Number(s.freeShippingOver),
  };
};

module.exports = { getSalesSettings, SALES_DEFAULTS: DEFAULTS };
