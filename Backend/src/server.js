const { port, emailWorkerEnabled } = require("./config");
const app = require("./app");
const prisma = require("./prisma");

const { startEmailWorker, verifySmtp } = require("./services/email/outbox");

const server = app.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
  if (emailWorkerEnabled) {
    startEmailWorker();
    verifySmtp().then((r) => console.log(`Email: ${r.message}`));
  }
  // Scheduled email reports and daily alerts (set SCHEDULER_ENABLED=false on extra instances if you like;
  // running it on several is safe: due reports are claimed with row locks).
  if (process.env.SCHEDULER_ENABLED !== "false") require("./services/scheduler").startScheduler();
});

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
