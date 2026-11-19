import { extractText, getDocumentProxy } from "unpdf";

export async function attachmentToText(filename: string, base64: string): Promise<string> {
  const buf = new Uint8Array(Buffer.from(base64, "base64"));
  if (/\.pdf$/i.test(filename)) {
    const pdf = await getDocumentProxy(buf);
    const { text } = await extractText(pdf, { mergePages: true });
    return text.trim();
  }
  return new TextDecoder().decode(buf).trim();
}

export function combineText(text: string, attachments: { filename: string; text: string }[]): string {
  return [text.trim(), ...attachments.map((a) => `--- Attachment: ${a.filename} ---\n${a.text}`)]
    .filter(Boolean)
    .join("\n\n");
}
