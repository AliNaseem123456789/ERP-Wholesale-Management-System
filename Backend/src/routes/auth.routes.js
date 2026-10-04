const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const c = require("../controllers/auth.controller");
const { verifyTokenFromCookie } = require("../jwt");
const { authRateLimit } = require("../config");

const limiter = (max) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { message: "Too many attempts. Please wait a few minutes and try again." },
  });
const authLimiter = limiter(authRateLimit);
const emailLimiter = limiter(Math.max(3, Math.ceil(authRateLimit / 3)));

const router = Router();
router.post("/login", authLimiter, c.login);
router.post("/register", authLimiter, c.register);
router.post("/refresh", c.refresh);
router.get("/me", verifyTokenFromCookie, c.me);
router.post("/logout", c.logout);
router.post("/logout-all", verifyTokenFromCookie, c.logoutAll);

router.post("/forgot-password", emailLimiter, c.forgotPassword);
router.post("/reset-password", authLimiter, c.resetPassword);
router.post("/change-password", verifyTokenFromCookie, authLimiter, c.changePassword);
router.post("/verify-email", authLimiter, c.verifyEmail);
router.post("/resend-verification", verifyTokenFromCookie, emailLimiter, c.resendVerification);

module.exports = router;
