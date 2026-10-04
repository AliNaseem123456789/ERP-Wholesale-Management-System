const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized: No user session" });
  }
  if (req.user.role === "ADMIN") return next();
  return res.status(403).json({ message: "Forbidden: You do not have admin privileges" });
};
module.exports = requireAdmin;
