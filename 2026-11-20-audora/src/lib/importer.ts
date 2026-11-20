import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import net from "node:net";
import dns from "node:dns/promises";
import { countWords, normalizeText } from "./segmenter/chunk";

export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_WORDS = 150_000;

export class ImportError extends Error {}

export function checkText(text: string): string {
  const t = normalizeText(text);
  if (!t) throw new ImportError("The story text is empty.");
  if (Buffer.byteLength(t, "utf8") > MAX_BYTES) throw new ImportError("The story is larger than the 2 MB limit.");
  if (countWords(t) > MAX_WORDS) throw new ImportError("The story is longer than the 150,000 word limit.");
  return t;
}

export function firstLineTitle(text: string): string {
  const line = text.split("\n").find((l) => l.trim()) ?? "Untitled story";
  return line.trim().replace(/^#+\s*/, "").slice(0, 80);
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.");
}

async function assertPublicHost(hostname: string): Promise<void> {
  if (process.env.ALLOW_PRIVATE_URLS === "1") return;
  const host = hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) throw new ImportError("Private or local URLs are not allowed.");
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addrs.some(isPrivateIp)) throw new ImportError("Private or local URLs are not allowed.");
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new ImportError("The page is larger than the 2 MB limit.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Fetch a public web page and extract the article text with Mozilla Readability. */
export async function importFromUrl(rawUrl: string): Promise<{ title: string; text: string; url: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ImportError("That does not look like a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ImportError("Only http(s) URLs are supported.");
  await assertPublicHost(url.hostname);
  let html: string;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: { "user-agent": "FullCastBot/0.1 (learning clone)", accept: "text/html,text/plain;q=0.9" },
    });
    if (!res.ok) throw new ImportError(`The page responded with HTTP ${res.status}.`);
    const finalHost = new URL(res.url || url.href).hostname;
    if (finalHost !== url.hostname) await assertPublicHost(finalHost);
    const type = res.headers.get("content-type") ?? "";
    html = await readCapped(res);
    if (type.startsWith("text/plain")) {
      const text = checkText(html);
      return { title: firstLineTitle(text), text, url: url.href };
    }
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError(`Could not fetch the URL: ${e instanceof Error ? e.message : "unknown error"}`);
  }
  const dom = new JSDOM(html, { url: url.href });
  const article = new Readability(dom.window.document).parse();
  if (!article || !article.content) throw new ImportError("Could not extract an article from that page.");
  // Rebuild paragraph structure from the cleaned article HTML (textContent loses it).
  const body = new JSDOM(article.content).window.document;
  const blocks = [...body.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote")]
    .filter((el) => !el.querySelector("p, li"))
    .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const text = checkText(blocks.length ? blocks.join("\n\n") : article.textContent ?? "");
  return { title: (article.title || dom.window.document.title || firstLineTitle(text)).trim().slice(0, 120), text, url: url.href };
}
