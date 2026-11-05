// ملف إكسل (.xlsx) بدون أي مكتبة: ملف zip فيه XML. يفتح في Excel وNumbers وGoogle Sheets
// كل ورقة: { name, rows: [[خلية…]], widths: [عرض كل عمود] }. الخلية رقم أو نص أو null،
// أو { v, pct: true } لنسبة مئوية. الصف الأول عنوان (عريض ومثبّت)
import { deflateRawSync, crc32 } from "node:zlib";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])
  // رموز التحكم ما يقبلها XML
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const col = (i) => { let s = ""; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
// اسم الورقة: ٣١ حرف بالكثير وبدون رموز ممنوعة
const sheetName = (s) => String(s).replace(/[[\]:*?/\\]/g, " ").slice(0, 31);

function cell(v, r, c, header) {
  const ref = col(c) + (r + 1);
  if (v == null || v === "" || (typeof v === "number" && !Number.isFinite(v))) return "";
  if (typeof v === "object") {
    if (v.v == null || !Number.isFinite(v.v)) return "";
    return `<c r="${ref}" s="2"><v>${v.v}</v></c>`;
  }
  if (typeof v === "number") return `<c r="${ref}"${header ? ' s="1"' : ""}><v>${v}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ""}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

function sheetXml({ rows, widths = [] }, rtl) {
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
  const data = rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, r, c, r === 0)).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${rtl ? ' rightToLeft="1"' : ""}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${data}</sheetData></worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" applyFont="1"/><xf numFmtId="10" applyNumberFormat="1"/></cellXfs></styleSheet>`;

// zip بسيط: كل ملف مضغوط deflate، وفهرس في الآخر
function zip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, text] of files) {
    const raw = Buffer.from(text, "utf8"), data = deflateRawSync(raw), nm = Buffer.from(name, "utf8");
    const crc = crc32(raw);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(nm.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8); dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(raw.length, 24); dir.writeUInt16LE(nm.length, 28); dir.writeUInt32LE(offset, 42);
    local.push(head, nm, data);
    central.push(dir, nm);
    offset += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

export function buildXlsx(sheets, { rtl = true } = {}) {
  const n = sheets.length;
  const files = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView${rtl ? ' rightToLeft="1"' : ""}/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${esc(sheetName(s.name))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", STYLES],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s, rtl)]),
  ];
  return zip(files);
}
