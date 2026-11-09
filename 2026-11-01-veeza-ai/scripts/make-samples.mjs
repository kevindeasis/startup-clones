// Generates placeholder sample uploads: a PNG "passport" and a PDF "bank statement".
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const PDFDocument = require("pdfkit");

const out = process.argv[2] || "data/samples";
fs.mkdirSync(out, { recursive: true });

// --- PNG (no deps): 400x260 light card with dark bars standing in for text lines
function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const W = 400, H = 260;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  for (let x = 0; x < W; x++) {
    const o = y * (W * 3 + 1) + 1 + x * 3;
    let c = [236, 240, 250];
    if (x > 20 && x < 110 && y > 40 && y < 150) c = [150, 160, 180]; // photo box
    if (x > 130 && x < 380 && [50, 75, 100, 125].some((r) => y > r && y < r + 8)) c = [40, 40, 60]; // text bars
    if (y > 200 && y < 208 || y > 222 && y < 230) c = [20, 20, 20]; // MRZ bars
    raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
  }
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
]);
fs.writeFileSync(path.join(out, "passport.png"), png);

// --- PDF bank statement via pdfkit
const doc = new PDFDocument({ size: "A4", margin: 48 });
doc.pipe(fs.createWriteStream(path.join(out, "bank_statement.pdf")));
doc.fontSize(18).text("Example Bank - Account Statement (SAMPLE)");
doc.moveDown().fontSize(11)
  .text("Account holder: AHMED MOHAMED ELSAYED")
  .text("Statement period: 2026-05-01 to 2026-10-31")
  .text("Opening balance: USD 3,800.00")
  .text("Closing balance: USD 4,200.00");
doc.moveDown().text("2026-05-05  Salary credit   +1,200.00");
doc.text("2026-06-05  Salary credit   +1,200.00");
doc.text("2026-07-05  Salary credit   +1,200.00");
doc.end();
console.log("wrote samples to", out);
