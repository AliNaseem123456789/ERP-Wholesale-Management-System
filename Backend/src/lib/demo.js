// Public demo logins: every visitor shares them (the login page lists them), so nothing may lock the others
// out or send mail to strangers. Demo accounts are the ones on example.com addresses (reserved, never real).
const { HttpError } = require("../utils/http");

const isDemoEmail = (email) => /(^|[@.])example\.com$/i.test(String(email || "").trim());

/** Middleware (after login is checked): refuses the action for demo accounts with a friendly message. */
const notForDemo = (what) => (req, res, next) => {
  if (isDemoEmail(req.user?.email)) return next(new HttpError(403, `This is a shared demo account, so ${what} is turned off.`));
  next();
};

/** For routes without a login (forgot password): refuses when the email in the body is a demo address. */
const notForDemoEmail = (what) => (req, res, next) => {
  if (isDemoEmail(req.body?.email)) return next(new HttpError(403, `This is a shared demo account, so ${what} is turned off. The password is on the sign-in page.`));
  next();
};

module.exports = { isDemoEmail, notForDemo, notForDemoEmail };
