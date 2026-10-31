const express = require("express");
const multer = require("multer");
const { verifyTokenFromCookie } = require("../jwt");
const requireAdmin = require("../middlware/requiredAdmin.js");
const ac = require("../controllers/adminCatalog.controller");
const a = require("../controllers/admin.controller");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const router = express.Router();

// Public: the homepage reads the feature banners from here.
router.get("/settings", a.getSiteSettings);

// Everything below requires an admin.
router.use(verifyTokenFromCookie, requireAdmin);
router.use(["/categories", "/attribute-templates"], require("../services/siteNav").onCategoryChange);

router.get("/kpis", a.kpis);
// run the background jobs now (they also run on their own schedule)
router.post("/jobs/:job", async (req, res) => {
  const jobs = require("../services/scheduler");
  if (req.params.job === "alerts") return res.json({ message: `${await jobs.dailyAlerts()} notification(s) created` });
  if (req.params.job === "reports") return res.json({ message: `${await jobs.runDueReports()} scheduled report(s) sent` });
  if (req.params.job === "recurring") return res.json({ message: `${await require("../services/recurring").runDue()} recurring order(s) run` });
  if (req.params.job === "stock-alerts") return res.json({ message: `${await require("../services/stockAlerts").checkAlerts()} back-in-stock alert(s) sent` });
  if (req.params.job === "quote-reminders") return res.json({ message: `${await require("../services/quoteFlow").quoteReminders()} quote reminder(s) sent` });
  res.status(404).json({ message: "Unknown job" });
});
// site content: menu, hero, notices, homepage, look
const site = require("../controllers/adminSite.controller");
router.get("/site", site.getSite);
router.put("/site/nav", site.saveNav);
router.post("/site/nav/preview", site.previewNav);
router.put("/site/hero", site.saveHero);
router.post("/site/hero/reset", site.resetHero);
router.put("/site/notices", site.saveNotices);
router.put("/site/appearance", site.saveAppearance);
router.put("/site/homepage", site.saveHomepage);
router.post("/site/homepage/publish", site.publishHomepage);
router.post("/site/homepage/reset", site.resetHomepage);
router.post("/site/homepage/versions/:index/restore", site.restoreHomepage);
router.post("/site/images", upload.single("image"), site.uploadImage);

// platform commission, review moderation, problem reports
const ins = require("../controllers/insights.controller");
router.get("/commission", ins.adminCommission);
router.post("/commission/statements", ins.createStatement);
router.get("/commission/statements/:id", ins.adminStatement);
router.patch("/commission/statements/:id", ins.updateStatement);
router.get("/reviews", ins.adminReviews);
router.patch("/reviews/:id", ins.moderateReview);
router.get("/reports", ins.adminReports);
router.patch("/reports/:id", ins.adminUpdateReport);

router.get("/users", a.getAllUsers);
router.patch("/users/:id/role", a.updateUserRole);
router.delete("/users/:id", a.deleteUser);

router.get("/products", a.getProducts);
router.post("/products", a.createProduct);
router.patch("/products/:id", a.updateProduct);
router.delete("/products/:id", a.deleteProduct);

router.post("/upload", upload.single("image"), a.uploadImage);
router.get("/products/:id/images", a.listProductImages);
router.post("/products/:id/images", upload.array("images", 6), a.addProductImages);
router.patch("/products/:id/images", a.updateProductImages);
router.delete("/products/:id/images/:imageId", a.deleteProductImage);

router.get("/companies", a.listCompanies);
router.post("/companies", a.createCompany);
router.patch("/companies/:id", a.updateCompany);
router.get("/brands", a.listAllBrands);
router.post("/brands/:id/assign", a.assignBrand);
router.patch("/brands/:id", ac.updateBrand);
router.post("/brands/:id/merge", ac.mergeBrand);

router.get("/categories", ac.listCategories);
router.post("/categories", ac.createCategory);
router.patch("/categories/:id", ac.updateCategory);
router.delete("/categories/:id", ac.deleteCategory);
router.post("/categories/:id/merge", ac.mergeCategory);
router.get("/categories/:id/attributes", ac.getCategoryAttributes);
router.put("/categories/:id/attributes", ac.setCategoryAttributes);
router.post("/categories/:id/apply-template", ac.applyTemplate);
router.get("/attribute-templates", ac.listTemplates);
router.get("/attributes", ac.listAttributes);
router.post("/attributes", ac.createAttribute);
router.patch("/attributes/:id", ac.updateAttribute);
router.delete("/attributes/:id", ac.deleteAttribute);
router.post("/attributes/:id/options", ac.addOption);
router.patch("/attribute-options/:optionId", ac.updateOption);
router.delete("/attribute-options/:optionId", ac.deleteOption);
router.get("/catalogue/health", ac.catalogueHealth);
router.get("/marketplace", ac.getMarketplace);
router.put("/marketplace", ac.saveMarketplace);
router.get("/collections", ac.listGlobalCollections);
router.post("/collections", ac.createGlobalCollection);
router.get("/collections/:id", ac.getGlobalCollection);
router.patch("/collections/:id", ac.updateGlobalCollection);
router.delete("/collections/:id", ac.deleteGlobalCollection);
router.get("/products/search", ac.searchAllProducts);
router.get("/companies/:id/storefront", ac.previewStorefront);

router.get("/emails", a.listEmails);
router.post("/emails/test", a.sendTestEmail);
router.post("/emails/:id/retry", a.retryEmail);
router.patch("/update-feature", upload.single("image"), a.updateFeatureSection);

module.exports = router;
