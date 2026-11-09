// Usage: node scripts/pdftext.mjs file.pdf  -> prints extracted text (pdf-parse)
import fs from "node:fs";
import { PDFParse } from "pdf-parse";
const p = new PDFParse({ data: new Uint8Array(fs.readFileSync(process.argv[2])) });
const r = await p.getText();
console.log(r.text);
await p.destroy();
