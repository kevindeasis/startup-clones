import { getContract, listClaims, parseClaimsCsv, replaceClaims, summarize } from "@/lib/repo";
import { readDataFile } from "@/lib/db";
import { err } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getContract(id)) return err("Contract not found", 404);
  const flag = new URL(req.url).searchParams.get("flag");
  return Response.json(listClaims(id, flag));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const contract = getContract(id);
  if (!contract) return err("Contract not found", 404);

  let csv = "";
  let sample = new URL(req.url).searchParams.get("sample") === "1";
  const ct = req.headers.get("content-type") || "";
  try {
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (file instanceof File) csv = await file.text();
      if (form.get("sample") === "1") sample = true;
    } else if (ct.includes("application/json")) {
      const body = await req.json();
      if (body.sample) sample = true;
      if (typeof body.csv === "string") csv = body.csv;
    } else {
      csv = await req.text();
    }
  } catch (e) {
    return err(`Could not read upload: ${(e as Error).message}`);
  }
  if (sample) csv = readDataFile("sample-claims.csv");
  if (!csv.trim()) return err("Provide a CSV file or {sample:true}.");

  const { rows: inputs, errors } = parseClaimsCsv(csv);
  if (errors.length && inputs.length === 0) return err(`CSV has no valid rows. ${errors.slice(0, 5).join(" | ")}`);
  const rows = replaceClaims(contract, inputs);
  return Response.json({ ...summarize(id), skipped_rows: errors, rows });
}
