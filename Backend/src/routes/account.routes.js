const express = require("express");
const {
  updateProfile,
  getMySubAccounts,
  updateSubAccountPermission,
  addSubAccount,
  getMyCreditHistory,
} = require("../controllers/account.controller");
const sales = require("../controllers/customerSales.controller");
const { verifyTokenFromCookie } = require("../jwt");

const router = express.Router();
router.use(verifyTokenFromCookie);

router.patch("/update-profile", updateProfile);
router.post("/add-subaccount", addSubAccount);
router.get("/my-sub-accounts", getMySubAccounts);
router.patch("/update-subaccount-permission", updateSubAccountPermission);
router.get("/my-history", getMyCreditHistory);

// invoices & credit notes from sellers
router.get("/invoices", sales.listInvoices);
router.get("/invoices/:id", sales.getInvoice);
router.get("/invoices/:id/pdf", sales.invoicePdf);
router.get("/credit-notes/:id/pdf", sales.creditNotePdf);
// quotes
router.get("/quotes", sales.listQuotes);
router.post("/quotes", sales.requestQuote);
router.get("/quotes/:id", sales.getQuote);
router.get("/quotes/:id/pdf", sales.quotePdf);
router.post("/quotes/:id/accept", sales.acceptQuote);
router.post("/quotes/:id/decline", sales.declineQuote);
// returns
router.get("/returns", sales.listReturns);
router.post("/returns", sales.requestReturn);
router.get("/returns/:id", sales.getReturn);
router.post("/returns/:id/cancel", sales.cancelReturn);
router.get("/orders/:id/returnable", sales.returnableLines);

module.exports = router;
