// Minimal RFC 4180 CSV: quoted fields, embedded commas/quotes/newlines, CRLF, UTF-8 BOM. No dependencies.

const parse = (text) => {
  const s = String(text || "").replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ""));
};

// -> { headers: [normalised names], records: [{ header: value }], line numbers start at 2 }
const parseRecords = (text) => {
  const rows = parse(text);
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => String(h).trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const records = rows.slice(1).map((r, i) => {
    const o = { _line: i + 2 };
    headers.forEach((h, j) => { o[h] = r[j] === undefined ? "" : String(r[j]).trim(); });
    return o;
  });
  return { headers, records };
};

const cell = (v) => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) v = v.join("|");
  if (typeof v === "object") v = JSON.stringify(v);
  let s = String(v);
  // keep spreadsheet apps from running formulas in exported text
  if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// columns: [{ key, label }] or ["key"]
const stringify = (rows, columns) => {
  const cols = columns.map((c) => (typeof c === "string" ? { key: c, label: c } : c));
  const lines = [cols.map((c) => cell(c.label)).join(",")];
  for (const r of rows) lines.push(cols.map((c) => cell(typeof c.value === "function" ? c.value(r) : r[c.key])).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
};

const sendCsv = (res, filename, text) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(text);
};

module.exports = { parse, parseRecords, stringify, sendCsv, cell };
