// Measures the network round trip from this computer to the database (read-only).
//   npm run db:ping
// Every page needs several database round trips, so this number times the round trips shown in the
// request log is roughly how long a page waits for data.
const { connect } = require("./_pg");
(async () => {
  const db = await connect();
  const times = [];
  for (let i = 0; i < 8; i++) {
    const t = process.hrtime.bigint();
    await db.query("SELECT 1");
    times.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  await db.end();
  const warm = times.slice(1).sort((a, b) => a - b);
  const median = warm[Math.floor(warm.length / 2)];
  const host = (process.env.DATABASE_URL || "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`Database ${host}`);
  console.log(`Round trip: median ${median.toFixed(0)} ms (fastest ${warm[0].toFixed(0)} ms, slowest ${warm[warm.length - 1].toFixed(0)} ms)`);
  console.log(median > 50
    ? `That's far away: a page needing 30 round trips waits about ${((median * 30) / 1000).toFixed(1)} s for data. Run the backend near the database (same region) to cut this to a few ms.`
    : "Close enough: database distance isn't what makes pages slow.");
})().catch((e) => { console.error(e.message); process.exit(1); });
