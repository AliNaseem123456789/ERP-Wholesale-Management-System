// Public marketplace API (optional login: logged-in customers also get their prices and stock numbers).
const express = require("express");
const { optionalAuth } = require("../jwt");
const m = require("../controllers/marketplace.controller");

const router = express.Router();
router.use(optionalAuth);
router.get("/settings", m.settings);
router.get("/home", m.home);
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

module.exports = router;
