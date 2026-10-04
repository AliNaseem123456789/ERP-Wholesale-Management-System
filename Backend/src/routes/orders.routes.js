const express = require("express");
const {
  checkout,
  checkoutSummary,
  getUserOrders,
  fetchPaymentHistory,
} = require("../controllers/orders.controller");
const { verifyTokenFromCookie } = require("../jwt");

const router = express.Router();
router.use(verifyTokenFromCookie);

router.get("/checkout-summary", checkoutSummary);
router.post("/checkout", checkout);
router.get("/my-orders", getUserOrders);
router.get("/payment-history", fetchPaymentHistory);

module.exports = router;
