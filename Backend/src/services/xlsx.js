// Minimal Excel (.xlsx) reading and writing for imports and exports. No dependencies: an .xlsx file is a zip of XML
// parts; Node's zlib does the compression. Writing: one sheet, a bold header row, text cells stay text (SKUs like
// "00123" keep their zeros), numbers stay numbers. Reading: the first sheet, shared or inline strings, numbers,
// booleans, and date cells (turned into YYYY-MM-DD).
const zlib = require("zlib");
const { HttpError } = require("../utils/http");

// ---- zip ----------------------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const zip = (files) => {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content, "utf8");
    const packed = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
};

const MAX_UNPACKED = 64 * 1024 * 1024; // a part bigger than this when unpacked is refused (protects against zip bombs)
const unzip = (buf) => {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new HttpError(400, "This isn't an Excel (.xlsx) file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new HttpError(400, "The Excel file is damaged");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(start, start + size);
    files.set(name, () => (method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: MAX_UNPACKED }) : (() => { throw new HttpError(400, "Unsupported Excel compression"); })()));
  }
  return files;
};

// ---- xml helpers --------------------------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  // characters XML can't hold
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const unesc = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, "&");
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`)); return m ? unesc(m[1]) : null; };
const colName = (i) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const colIndex = (ref) => { const letters = ref.replace(/\d+/g, ""); let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

// ---- write --------------------------------------------------------------------------------------
const isDecimal = (v) => v && typeof v === "object" && typeof v.toFixed === "function" && typeof v.toNumber === "function";
const cellXml = (ref, v, header) => {
  if (v === null || v === undefined || v === "") return "";
  const style = header ? ' s="1"' : "";
  if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
  if (typeof v === "bigint") v = v.toString();
  if (isDecimal(v)) return `<c r="${ref}"${style}><v>${v.toString()}</v></c>`;
  if (typeof v === "boolean") return `<c r="${ref}"${style} t="b"><v>${v ? 1 : 0}</v></c>`;
  if (v instanceof Date) v = v.toISOString().slice(0, 10);
  if (Array.isArray(v)) v = v.join("|");
  if (typeof v === "object") v = JSON.stringify(v);
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(String(v).slice(0, 32767))}</t></is></c>`;
};

/** rows: objects; columns: [{ key, label, value? }] or ["key"] (same as the CSV writer). Returns a Buffer. */
const write = (rows, columns, sheetName = "Sheet1") => {
  const cols = columns.map((c) => (typeof c === "string" ? { key: c, label: c } : c));
  const lines = [];
  lines.push(`<row r="1">${cols.map((c, i) => cellXml(`${colName(i)}1`, c.label, true)).join("")}</row>`);
  rows.forEach((r, ri) => {
    const n = ri + 2;
    lines.push(`<row r="${n}">${cols.map((c, i) => cellXml(`${colName(i)}${n}`, typeof c.value === "function" ? c.value(r) : r[c.key], false)).join("")}</row>`);
  });
  const widths = cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, Math.max(10, String(c.label).length + 4))}" customWidth="1"/>`).join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${lines.join("")}</sheetData></worksheet>`;
  const name = esc(String(sheetName).replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1");
  return zip([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ["xl/worksheets/sheet1.xml", sheet],
  ]);
};

// ---- read ---------------------------------------------------------------------------------------
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const serialToDate = (n) => {
  const ms = Math.round((n - 25569) * 86400000); // 1900 date system
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? String(n) : (n % 1 ? d.toISOString().slice(0, 19).replace("T", " ") : d.toISOString().slice(0, 10));
};

/** Buffer of an .xlsx -> array of rows (arrays of strings) of the first sheet. */
const read = (buf, opts = {}) => {
  try {
    return readSheet(buf, opts);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, err.code === "ERR_BUFFER_TOO_LARGE" ? "The Excel file is too big once unpacked" : "The Excel file couldn't be read. Save it again as .xlsx, or use CSV.");
  }
};
const readSheet = (buf, { maxRows = 20000 } = {}) => {
  const files = unzip(buf);
  const get = (name) => { const f = files.get(name); return f ? f().toString("utf8") : null; };
  const workbook = get("xl/workbook.xml");
  if (!workbook) throw new HttpError(400, "This isn't an Excel (.xlsx) file");
  // first sheet's file
  const firstSheet = (workbook.match(/<sheet\b[^>]*>/) || [])[0];
  const rid = firstSheet ? attr(firstSheet, "r:id") : null;
  const rels = get("xl/_rels/workbook.xml.rels") || "";
  let target = "worksheets/sheet1.xml";
  for (const rel of rels.match(/<Relationship\b[^>]*>/g) || []) if (attr(rel, "Id") === rid) target = attr(rel, "Target");
  const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  const sheet = get(sheetPath);
  if (!sheet) throw new HttpError(400, "The Excel file has no sheets");

  const shared = [];
  const sst = get("xl/sharedStrings.xml");
  if (sst) for (const si of sst.match(/<si>[\s\S]*?<\/si>/g) || []) shared.push(unesc((si.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<t\b[^>]*>|<\/t>/g, "")).join("")));

  // which cell styles are dates
  const dateStyles = new Set();
  const styles = get("xl/styles.xml");
  if (styles) {
    const custom = new Map();
    for (const nf of styles.match(/<numFmt\b[^>]*>/g) || []) custom.set(Number(attr(nf, "numFmtId")), attr(nf, "formatCode") || "");
    const xfs = (styles.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/) || [""])[0].match(/<xf\b[^>]*>/g) || [];
    xfs.forEach((xf, i) => {
      const id = Number(attr(xf, "numFmtId") || 0);
      const code = custom.get(id);
      if (BUILTIN_DATE_FORMATS.has(id) || (code && /[dmy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, "")) && !/0\.0/.test(code))) dateStyles.add(i);
    });
  }

  const rows = [];
  for (const rowXml of sheet.match(/<row\b[\s\S]*?(?:<\/row>|\/>)/g) || []) {
    if (rows.length > maxRows) break;
    const row = [];
    for (const m of rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = `<c${m[1]}>`;
      const inner = m[2] || "";
      const ref = attr(tag, "r");
      const t = attr(tag, "t");
      const s = Number(attr(tag, "s") || 0);
      const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let out = "";
      if (t === "s") out = shared[Number(v)] ?? "";
      else if (t === "inlineStr") out = unesc((inner.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || []).map((x) => x.replace(/<t\b[^>]*>|<\/t>/g, "")).join(""));
      else if (t === "b") out = v === "1" ? "true" : "false";
      else if (t === "str" || t === "e") out = v !== undefined ? unesc(v) : "";
      else if (v !== undefined) {
        const n = Number(v);
        out = dateStyles.has(s) && Number.isFinite(n) ? serialToDate(n) : Number.isFinite(n) ? String(Math.round(n * 1e10) / 1e10) : unesc(v);
      }
      const idx = ref ? colIndex(ref) : row.length;
      while (row.length < idx) row.push("");
      row[idx] = out;
    }
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ""));
};

const CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const sendXlsx = (res, filename, buffer) => {
  res.setHeader("Content-Type", CONTENT_TYPE);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(buffer);
};

module.exports = { write, read, sendXlsx, zip, unzip, crc32, CONTENT_TYPE };
