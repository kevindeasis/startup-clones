import { listAgencies, listDocuments } from "@/lib/data";
import { NewDocForm } from "../../components/NewDocForm";

export const dynamic = "force-dynamic";

export default async function NewDocumentPage() {
  const [agencies, docs] = await Promise.all([listAgencies(), listDocuments()]);
  return (
    <>
      <h1>Add document</h1>
      <p className="sub">Paste text or upload a file. Extraction runs inline: signals, fit scores and (for solicitations) the requirements checklist; addenda run the change pipeline.</p>
      <NewDocForm
        agencies={agencies.map((a) => ({ id: a.id, name: a.name }))}
        solicitations={docs.filter((d) => d.kind === "solicitation").map((d) => ({ id: d.id, name: d.title }))}
      />
    </>
  );
}
