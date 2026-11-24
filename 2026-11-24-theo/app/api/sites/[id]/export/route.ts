import { promises as fs } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { readSite } from "@/lib/store";
import { renderPage, robotsTxt, sitemapXml } from "@/lib/render";
import { err, msg } from "@/lib/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const site = await readSite((await params).id);
  if (!site) return err("Site not found", 404);
  try {
    const origin = new URL(req.url).origin;
    const files: Record<string, string> = {};
    for (const p of site.pages) {
      const rel = p.path === "/" ? "index.html" : `${p.path.slice(1)}/index.html`;
      files[rel] = renderPage(site, p, origin, { staticMode: true });
    }
    files["sitemap.xml"] = sitemapXml(site, origin);
    files["robots.txt"] = robotsTxt(site, origin);
    const dir = path.join(process.cwd(), "exports", site.slug);
    await fs.rm(dir, { recursive: true, force: true });
    const zip = new JSZip();
    for (const [rel, content] of Object.entries(files)) {
      const out = path.join(dir, rel);
      if (!out.startsWith(dir + path.sep)) continue;
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, content);
      zip.file(rel, content);
    }
    const buf = await zip.generateAsync({ type: "uint8array" });
    return new Response(buf as BodyInit, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${site.slug}.zip"` } });
  } catch (e) {
    return err(msg(e));
  }
}
