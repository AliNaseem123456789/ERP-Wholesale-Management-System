const express = require("express");
const {
  updateProfile,
  getMySubAccounts,
  updateSubAccountPermission,
  addSubAccount,
  getMyCreditHistory,
} = require("../controllers/account.controller");
const rfq = require("../controllers/rfq.controller");
const buying = require("../controllers/buying.controller");
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
router.post("/quotes/:id/counter", sales.counterQuote);
router.post("/quotes/:id/messages", sales.postQuoteMessage);
router.get("/rfqs", rfq.listRfqs);
router.post("/rfqs", rfq.createRfq);
router.get("/rfqs/:id", rfq.getRfq);
router.post("/rfqs/:id/award", rfq.awardRfq);
router.post("/rfqs/:id/cancel", rfq.cancelRfq);
// returns
router.get("/recurring-orders", buying.listRecurring);
router.post("/recurring-orders", buying.createRecurring);
router.get("/recurring-orders/:id", buying.getRecurring);
router.patch("/recurring-orders/:id", buying.updateRecurring);
router.delete("/recurring-orders/:id", buying.cancelRecurring);
router.post("/recurring-orders/:id/run", buying.runNow);
router.get("/stock-alerts", buying.listAlerts);
router.post("/stock-alerts", buying.createAlert);
router.delete("/stock-alerts/:id", buying.deleteAlert);

router.get("/returns", sales.listReturns);
router.post("/returns", sales.requestReturn);
router.get("/returns/:id", sales.getReturn);
router.post("/returns/:id/cancel", sales.cancelReturn);
router.get("/orders/:id/returnable", sales.returnableLines);

module.exports = router;
