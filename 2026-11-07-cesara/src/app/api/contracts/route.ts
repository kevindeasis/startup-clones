import { extractTerms, isMock } from "@/lib/llm";
import { createContract, listContracts } from "@/lib/repo";
import { readDataFile } from "@/lib/db";
import { err } from "@/lib/http";
import { extractText, getDocumentProxy } from "unpdf";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  return Response.json(listContracts());
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  let text = "";
  let name: string | undefined;
  let sample = url.searchParams.get("sample") === "1";

  const ct = req.headers.get("content-type") || "";
  try {
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      if (form.get("sample") === "1" || form.get("sample") === "true") sample = true;
      const file = form.get("file");
      if (file instanceof File) {
        name = file.name;
        const buf = new Uint8Array(await file.arrayBuffer());
        if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
          const pdf = await getDocumentProxy(buf);
          const res = await extractText(pdf, { mergePages: true });
          text = res.text;
        } else {
          text = new TextDecoder().decode(buf);
        }
      } else if (typeof form.get("text") === "string") {
        text = form.get("text") as string;
        name = (form.get("name") as string) || undefined;
      }
    } else if (ct.includes("application/json")) {
      const body = await req.json();
      if (body.sample) sample = true;
      if (typeof body.text === "string") text = body.text;
      if (typeof body.name === "string") name = body.name;
    }
  } catch (e) {
    return err(`Could not read upload: ${(e as Error).message}`);
  }

  if (sample) {
    text = readDataFile("sample-contract.md");
    name = name || "Blue Harbor - Riverside PPO Agreement (sample)";
  }
  if (!text.trim()) return err("Provide a PDF/text file, JSON {text}, or {sample:true}.");

  try {
    const terms = await extractTerms(text);
    const id = createContract(name || terms.contract_name, text, terms);
    return Response.json({ id, payer: terms.payer, terms_count: terms.terms.length, mock: isMock() });
  } catch (e) {
    return err(`Extraction failed: ${(e as Error).message}`, 502);
  }
}
