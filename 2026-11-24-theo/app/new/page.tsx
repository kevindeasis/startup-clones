import NewSite from "./NewSite";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return <NewSite initial={{ name: sp.name ?? "", city: sp.city ?? "", existingUrl: sp.url ?? "", services: sp.services ?? "" }} />;
}
