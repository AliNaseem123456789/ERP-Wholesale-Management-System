const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const { corsOrigins, isProd } = require("./config");
const { HttpError } = require("./utils/http");

const authRoutes = require("./routes/auth.routes");
const productRoutes = require("./routes/product.routes");
const cartRoutes = require("./routes/cart.routes");
const addressRoutes = require("./routes/address.routes");
const orderRoutes = require("./routes/orders.routes");
const accountRoutes = require("./routes/account.routes");
const adminRoutes = require("./routes/admin.routes");
const companyRoutes = require("./routes/company.routes");
const publicRoutes = require("./routes/public.routes");

const app = express();
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

app.use(
  cors({
    origin(origin, cb) {
      // Allow same-origin / server-to-server requests (no Origin header) and listed origins.
      if (!origin || corsOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  }),
);
// CSV imports may be larger than ordinary requests.
const jsonSmall = express.json({ limit: "1mb" });
const jsonLarge = express.json({ limit: "6mb" });
app.use((req, res, next) => (req.path.startsWith("/api/company/import/") ? jsonLarge : jsonSmall)(req, res, next));
app.use(cookieParser());

if (!isProd) {
  app.use((req, res, next) => {
    console.log(`${new Date().toLocaleTimeString()} ${req.method} ${req.originalUrl}`);
    next();
  });
}

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/address", addressRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/account", accountRoutes);
// Old frontend path for credit history
app.use("/api/credit", accountRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/notifications", require("./routes/notifications.routes"));
app.use("/api/company", companyRoutes);
app.use("/api", publicRoutes);

app.use("/api", (req, res) => res.status(404).json({ message: "Not found" }));

// Central error handler (Express 5 forwards rejected promises here automatically).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError || (err.status && err.status < 500)) {
    return res.status(err.status).json({ message: err.message });
  }
  // Malformed JSON body
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Invalid JSON body" });
  }
  // Upload too large
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ message: "File is too large (max 5 MB)" });
  }
  // Prisma "record not found"
  if (err.code === "P2025") {
    return res.status(404).json({ message: "Not found" });
  }
  // Prisma unique constraint
  if (err.code === "P2002") {
    return res.status(409).json({ message: "Already exists" });
  }
  // Prisma foreign key
  if (err.code === "P2003") {
    return res.status(409).json({ message: "This record is still referenced by other data" });
  }
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
});

module.exports = app;
