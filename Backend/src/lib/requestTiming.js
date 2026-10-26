// Per-request timing: how long each API request took, how many database queries it made, and how many
// database "round trips" they needed (queries that overlap in time count as one trip, queries that wait for
// each other count separately). With a far-away database every round trip costs the network delay, so
// round trips, not query count, are what make a page slow.
//
// Printed in the terminal for every request (always in development; in production set REQUEST_LOG=on):
//   21:39:22 GET /api/marketplace/homepage 200  842 ms · 14 queries in 6 round trips · db 790 ms
// Also sent to the browser as a Server-Timing header (DevTools -> Network -> Timing).
//   REQUEST_LOG=off      no terminal lines
//   REQUEST_LOG_SLOW=300 only print requests slower than this many ms
// It also watches the event loop: if synchronous work ever freezes the server for 100 ms or more, a line says so.
const { AsyncLocalStorage } = require("async_hooks");
const { performance, monitorEventLoopDelay } = require("perf_hooks");

const als = new AsyncLocalStorage();

/** Called by the database client around every query (see prisma.js). */
const trackQuery = async (run) => {
  const store = als.getStore();
  if (!store) return run();
  const t0 = performance.now();
  try {
    return await run();
  } finally {
    store.queries.push([t0, performance.now()]);
  }
};

/** Total time the database was busy (overlaps counted once) and the number of round trips. */
const summarize = (queries) => {
  const list = [...queries].sort((a, b) => a[0] - b[0]);
  let busy = 0;
  let trips = 0;
  let end = -Infinity;
  let start = 0;
  for (const [s, e] of list) {
    if (s > end) {
      if (trips) busy += end - start;
      trips++;
      start = s;
      end = e;
    } else end = Math.max(end, e);
  }
  if (trips) busy += end - start;
  return { count: list.length, trips, busy };
};

const env = (process.env.REQUEST_LOG || "").toLowerCase();
const enabled = env ? !["off", "false", "0", "no"].includes(env) : process.env.NODE_ENV !== "production";
const slowMs = Number(process.env.REQUEST_LOG_SLOW) || 0;
const tty = process.stdout.isTTY;
const paint = (ms, text) => (!tty ? text : ms >= 1000 ? `\x1b[31m${text}\x1b[0m` : ms >= 300 ? `\x1b[33m${text}\x1b[0m` : `\x1b[32m${text}\x1b[0m`);

const requestTiming = (req, res, next) => {
  const store = { start: performance.now(), queries: [] };
  const writeHead = res.writeHead;
  // the header has to go out with the response, so it reports what happened up to that moment
  res.writeHead = function (...args) {
    if (!res.headersSent) {
      const s = summarize(store.queries);
      const total = performance.now() - store.start;
      res.setHeader("Server-Timing", `db;dur=${s.busy.toFixed(1)};desc="${s.count} queries, ${s.trips} round trips", total;dur=${total.toFixed(1)}`);
    }
    return writeHead.apply(this, args);
  };
  if (enabled) {
    res.on("finish", () => {
      const total = performance.now() - store.start;
      if (total < slowMs) return;
      const s = summarize(store.queries);
      const ms = `${Math.round(total)} ms`.padStart(7);
      const db = s.count ? ` · ${s.count} quer${s.count === 1 ? "y" : "ies"} in ${s.trips} round trip${s.trips === 1 ? "" : "s"} · db ${Math.round(s.busy)} ms` : "";
      console.log(`${new Date().toLocaleTimeString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${paint(total, ms)}${db}`);
    });
  }
  als.run(store, next);
};

// event-loop watchdog: worst delay in each 10 s window
if (enabled) {
  const h = monitorEventLoopDelay({ resolution: 20 });
  h.enable();
  setInterval(() => {
    const worst = h.max / 1e6;
    if (worst >= 100) console.log(`${new Date().toLocaleTimeString()} ${paint(1000, `event loop blocked for up to ${Math.round(worst)} ms`)} in the last 10 s (synchronous work is holding up every request)`);
    h.reset();
  }, 10000).unref();
}

module.exports = { requestTiming, trackQuery, summarize };
