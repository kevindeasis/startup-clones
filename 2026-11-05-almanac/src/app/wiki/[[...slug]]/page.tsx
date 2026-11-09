import { WikiView } from "../../components/WikiView";

export default async function WikiPageRoute({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  return <WikiView path={slug?.map(decodeURIComponent).join("/")} />;
}
