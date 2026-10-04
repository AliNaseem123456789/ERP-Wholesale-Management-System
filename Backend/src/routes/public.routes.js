// Public (no login required) routes: company directory and invitation links.
const express = require("express");
const { optionalAuth } = require("../jwt");
const companies = require("../controllers/companies.public.controller");
const team = require("../controllers/company/team.controller");

const router = express.Router();
router.use(optionalAuth);

router.get("/companies", companies.listCompanies);
router.get("/companies/:slug", companies.getCompany);
router.get("/invitations/:token", team.previewInvitation);
router.post("/invitations/:token/accept", team.acceptInvitation);

module.exports = router;
