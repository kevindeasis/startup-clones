import { ImportForm } from "@/components/ImportForm";
import { StoryList } from "@/components/StoryList";
import { listSamples } from "@/lib/samples";
import { listStories } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function LibraryPage() {
  const stories = listStories();
  const samples = listSamples();
  return (
    <main className="container">
      <section className="card">
        <h1>Import a story</h1>
        <p className="muted">Paste text, upload a .txt/.md file, or give a public URL. Then generate the script and listen.</p>
        <ImportForm samples={samples} />
      </section>
      <section className="card">
        <h2>Library</h2>
        <StoryList stories={stories} />
      </section>
    </main>
  );
}
