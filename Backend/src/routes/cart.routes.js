const { Router } = require("express");
const c = require("../controllers/cart.controller");
const { verifyTokenFromCookie } = require("../jwt");

const router = Router();
router.use(verifyTokenFromCookie);

router.get("/", c.fetchCartProducts);
router.post("/add", c.addToCart);
router.post("/save-cart-template", c.saveCartTemplate);
router.get("/saved-cart-templates", c.fetchSavedTemplates);
router.get("/saved-cart-templates-details/:id", c.fetchSavedTemplateDetails);
router.delete("/saved-cart-templates/:id", c.deleteSavedTemplate);
router.post("/saved-cart-templates/:id/restore", c.restoreSavedTemplate);
router.patch("/:productId", c.updateQuantity);
router.delete("/:productId", c.removeFromCart);

module.exports = router;
