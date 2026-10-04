// Transactional email via an outbox table:
//   queueEmail() stores the message -> the worker sends it over SMTP with retries.
// Emails survive restarts, failed sends are retried with backoff, and the history is auditable.
const nodemailer = require("nodemailer");
const prisma = require("../../prisma");
const { smtp, isProd } = require("../../config");
const { templates } = require("./templates");

const MAX_ATTEMPTS = 5;
const SEND_CONCURRENCY = 3;
let transporter = null;

const getTransporter = () => {
  if (!smtp.host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      // Reuse connections: opening a new SMTP connection per email is slow (~0.3-1s each).
      pool: true,
      maxConnections: SEND_CONCURRENCY,
      maxMessages: 100,
    });
  }
  return transporter;
};

/**
 * Queue an email. `template` is a key of templates.js, `data` its parameters.
 * Never throws: email problems must not break the request that triggered them.
 */
const queueEmail = async ({ to, template, data = {}, companyId = null, attachments = null, db = prisma }) => {
  try {
    if (!to) return null;
    const render = templates[template];
    if (!render) throw new Error(`Unknown email template: ${template}`);
    const { subject, html, text } = render(data);
    const row = await db.email_outbox.create({
      data: {
        to_email: String(to).toLowerCase(),
        subject,
        html,
        text,
        template,
        company_id: companyId ? BigInt(companyId) : null,
        // [{ kind: "invoice" | "credit_note" | "quote" | "payslip" | "report_run", id }]: files are generated when the email is sent
        attachments: attachments?.length ? attachments.map((a) => ({ kind: a.kind, id: String(a.id) })) : undefined,
      },
    });
    // Registered users also see it in their notifications (the bell).
    if (db === prisma) await require("../inapp").fromEmail({ to, template, data, companyId });
    // Send soon, but outside the current request / transaction.
    setTimeout(() => processOutbox().catch(() => {}), 50).unref?.();
    return row;
  } catch (err) {
    console.error("queueEmail failed:", err.message);
    return null;
  }
};

let current = null;
let rerun = false;

// Sends due emails. If called while a batch is in progress, another pass runs right after
// (so emails queued during a send never wait for the next worker tick) and the caller
// gets a promise that resolves when everything due has been processed.
const processOutbox = (limit = 20) => {
  if (current) {
    rerun = true;
    return current;
  }
  current = (async () => {
    try {
      do {
        rerun = false;
        await sendBatch(limit);
      } while (rerun);
    } finally {
      current = null;
    }
  })();
  return current;
};

const sendBatch = async (limit) => {
  // Recover rows stuck in "sending" (e.g. the process crashed mid-send).
  await prisma.$executeRaw`UPDATE email_outbox SET status = 'pending'
    WHERE status = 'sending' AND send_after < now() - interval '10 minutes'`;

  /** @type {any[]} */
  const batch = await prisma.$queryRaw`
    UPDATE email_outbox SET status = 'sending', send_after = now()
    WHERE id IN (
      SELECT id FROM email_outbox
      WHERE status = 'pending' AND send_after <= now()
      ORDER BY id LIMIT ${limit}
      FOR UPDATE SKIP LOCKED)
    RETURNING id, to_email, subject, html, text, attempts, attachments`;
  if (batch.length === limit) rerun = true;

  const transport = getTransporter();
  // Send a few at a time over the pooled connections.
  const queue = [...batch];
  const worker = async () => {
    while (queue.length) await sendOne(transport, queue.shift());
  };
  await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, queue.length) }, worker));
};

const sendOne = async (transport, mail) => {
  try {
    if (!transport) {
      // No SMTP configured: print the email so links can be used during development.
      if (!isProd) {
        console.log(`\n✉️  [email not sent: SMTP not configured] to=${mail.to_email}\n   ${mail.subject}\n   ${(mail.text || "").replace(/\n+/g, "\n   ")}\n`);
      }
      throw new Error("SMTP is not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS)");
    }
    const attachments = [];
    for (const a of Array.isArray(mail.attachments) ? mail.attachments : []) {
      // Lazy require: documents.js loads prisma models that aren't needed for plain emails.
      const { attachmentFor } = require("../documents");
      attachments.push(await attachmentFor(a.kind, a.id));
    }
    await transport.sendMail({
      from: smtp.from,
      to: mail.to_email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text || undefined,
      attachments: attachments.length ? attachments : undefined,
    });
    await prisma.email_outbox.update({
      where: { id: mail.id },
      data: { status: "sent", sent_at: new Date(), attempts: { increment: 1 }, last_error: null },
    });
  } catch (err) {
    const attempts = mail.attempts + 1;
    const giveUp = attempts >= MAX_ATTEMPTS || !transport;
    await prisma.email_outbox.update({
      where: { id: mail.id },
      data: {
        status: giveUp ? "failed" : "pending",
        attempts,
        last_error: String(err.message).slice(0, 1000),
        // backoff: 2, 4, 8, 16 minutes
        send_after: new Date(Date.now() + 2 ** attempts * 60 * 1000),
      },
    });
  }
};

let timer = null;
const startEmailWorker = (intervalMs = 30000) => {
  if (timer) return;
  timer = setInterval(() => processOutbox().catch((e) => console.error("email worker:", e.message)), intervalMs);
  timer.unref?.();
};

const verifySmtp = async () => {
  const t = getTransporter();
  if (!t) return { ok: false, message: "SMTP not configured" };
  try {
    await t.verify();
    return { ok: true, message: `SMTP connection to ${smtp.host} OK` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
};

module.exports = { queueEmail, processOutbox, startEmailWorker, verifySmtp };
