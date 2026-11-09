import { getDestination } from "./destinations";
import { computeRuleResults } from "./rules";
import { computeScore, topFixes } from "./scoring";
import { getApplication, listDocuments, listTravellers, parseNotes } from "./repo";

export async function buildView(id: string) {
  const app = await getApplication(id);
  if (!app) return null;
  const dest = getDestination(app.destinationCode);
  if (!dest) return null;
  const [travellers, documents] = await Promise.all([listTravellers(id), listDocuments(id)]);
  const { results, effective } = computeRuleResults(app, dest, travellers, documents);
  const { score, band } = computeScore(results);
  return {
    app, dest, travellers, documents, results, effective, score, band, fixes: topFixes(results),
    json: {
      application: { ...app, notes: parseNotes(app) },
      destination: dest,
      requiredDocuments: dest.docs,
      serviceFeeUSD: dest.feeUSD * app.travellerCount,
      travellers: travellers.map((t) => ({ id: t.id, index: t.index, passport: t.passport, passportConfidence: t.passportConfidence })),
      documents: documents.map((d) => ({
        id: d.id, travellerId: d.travellerId, type: d.type, mimeType: d.mimeType,
        verification: effective.get(d.id) ?? d.verification, createdAt: d.createdAt,
      })),
      checks: results,
      score: { score, band },
    },
  };
}
