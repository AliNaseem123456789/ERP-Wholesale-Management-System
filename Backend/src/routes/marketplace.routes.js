// Public marketplace API (optional login: logged-in customers also get their prices and stock numbers).
const express = require("express");
const { optionalAuth } = require("../jwt");
const m = require("../controllers/marketplace.controller");

const router = express.Router();
router.use(optionalAuth);
router.get("/settings", m.settings);
router.get("/home", m.home);
router.get("/deals/codes", m.dealCodes);
// page views and searches for seller analytics (anonymous; repeats within 30 minutes count once)
router.post("/track", require("express-rate-limit")({ windowMs: 60 * 1000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false, message: { message: "Too many requests" } }), m.track);
router.get("/products", m.products);
router.get("/categories", m.categories);
router.get("/categories/:slug", m.category);
router.get("/brands", m.brands);
router.get("/brands/:slug", m.brand);
router.get("/companies", m.companies);
router.get("/companies/:slug", m.company);
router.get("/companies/:slug/products", m.companyProducts);
router.get("/companies/:slug/collections/:collection", m.companyCollection);
router.get("/collections/:slug", m.collection);
router.get("/products/:id/reviews", require("../controllers/insights.controller").productReviews);
router.get("/companies/:slug/reviews", require("../controllers/insights.controller").companyReviews);

module.exports = router;
