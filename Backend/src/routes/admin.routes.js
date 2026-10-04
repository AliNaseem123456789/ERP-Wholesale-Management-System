const express = require("express");
const multer = require("multer");
const { verifyTokenFromCookie } = require("../jwt");
const requireAdmin = require("../middlware/requiredAdmin.js");
const a = require("../controllers/admin.controller");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const router = express.Router();

// Public: the homepage reads the feature banners from here.
router.get("/settings", a.getSiteSettings);

// Everything below requires an admin.
router.use(verifyTokenFromCookie, requireAdmin);

router.get("/kpis", a.kpis);
// run the background jobs now (they also run on their own schedule)
router.post("/jobs/:job", async (req, res) => {
  const jobs = require("../services/scheduler");
  if (req.params.job === "alerts") return res.json({ message: `${await jobs.dailyAlerts()} notification(s) created` });
  if (req.params.job === "reports") return res.json({ message: `${await jobs.runDueReports()} scheduled report(s) sent` });
  res.status(404).json({ message: "Unknown job" });
});
router.get("/users", a.getAllUsers);
router.patch("/users/:id/role", a.updateUserRole);
router.delete("/users/:id", a.deleteUser);

router.get("/products", a.getProducts);
router.post("/products", a.createProduct);
router.patch("/products/:id", a.updateProduct);
router.delete("/products/:id", a.deleteProduct);

router.post("/upload", upload.single("image"), a.uploadImage);

router.get("/companies", a.listCompanies);
router.post("/companies", a.createCompany);
router.patch("/companies/:id", a.updateCompany);
router.get("/brands", a.listAllBrands);
router.post("/brands/:id/assign", a.assignBrand);

router.get("/emails", a.listEmails);
router.post("/emails/test", a.sendTestEmail);
router.post("/emails/:id/retry", a.retryEmail);
router.patch("/update-feature", upload.single("image"), a.updateFeatureSection);

module.exports = router;
