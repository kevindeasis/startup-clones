import { PDFParse } from "pdf-parse";

export const STORE_LIMIT = 20_000;

export async function pdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const res = await parser.getText();
    return (res.text || "").trim();
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}
