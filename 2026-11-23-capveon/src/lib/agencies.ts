import { getAgency, listAgencies, listAwards, listContacts, listDocuments, listSignals } from "./data";
import { fiscalYear, summarizeSpend, threeYearSpend } from "./spend";
import { compareSignals } from "./stages";

export async function agencySummaries() {
  const [agencies, docs, signals, awards] = await Promise.all([listAgencies(), listDocuments(), listSignals(), listAwards()]);
  const latest = awards.reduce((m, a) => Math.max(m, fiscalYear(a.date)), 0);
  return agencies.map((a) => ({
    ...a,
    documents: docs.filter((d) => d.agencyId === a.id).length,
    signals: signals.filter((s) => s.agencyId === a.id).length,
    spend3y: threeYearSpend(awards.filter((x) => x.agencyId === a.id), latest),
  }));
}

export async function agencyDetail(id: string) {
  const agency = await getAgency(id);
  if (!agency) return undefined;
  const [docs, signals, awards, contacts] = await Promise.all([listDocuments(), listSignals(), listAwards(), listContacts()]);
  const mine = awards.filter((a) => a.agencyId === id);
  return {
    agency,
    spend: summarizeSpend(mine),
    awards: mine.sort((a, b) => b.date.localeCompare(a.date)),
    documents: docs
      .filter((d) => d.agencyId === id)
      .map((d) => ({ id: d.id, title: d.title, kind: d.kind, date: d.date, pages: d.pages.length, status: d.status })),
    signals: signals.filter((s) => s.agencyId === id).sort(compareSignals),
    contacts: contacts.filter((c) => c.agencyId === id),
  };
}
