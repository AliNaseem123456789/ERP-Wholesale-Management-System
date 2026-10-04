const { Router } = require("express");
const {
  fetchBrands,
  fetchHomeProducts,
  fetchProductsByBrand,
  fetchProductsByCategory,
  fetchProductById,
  searchProducts,
} = require("../controllers/product.controller");
const { optionalAuth } = require("../jwt");

const router = Router();
router.use(optionalAuth);

router.get("/brands", fetchBrands);
router.get("/display", fetchBrands); // old name, kept for compatibility
router.get("/brand/:brand", fetchProductsByBrand);
router.get("/category/:category", fetchProductsByCategory);
router.get("/product/:id", fetchProductById);
router.get("/home", fetchHomeProducts);
router.get("/search", searchProducts);
// Product creation moved to the admin-only POST /api/admin/products.

module.exports = router;
