import { promises as dns } from "node:dns";
import net from "node:net";

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === "::1" || l === "::") return true;
    if (l.startsWith("::ffff:")) return isPrivateIp(l.slice(7));
    return l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80");
  }
  return false;
}

/** Synchronous check of the URL string itself. Returns an error message or null if acceptable. */
export function checkUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "Invalid URL";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "Only http(s) URLs are allowed";
  if (process.env.ALLOW_PRIVATE_URLS === "1") return null;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return "Private/localhost URLs are not allowed";
  }
  if (net.isIP(host) && isPrivateIp(host)) return "Private IP addresses are not allowed";
  return null;
}

/** Full check including DNS resolution (guards against hostnames that resolve to private ranges). */
export async function assertSafeUrl(raw: string): Promise<string | null> {
  const err = checkUrl(raw);
  if (err) return err;
  if (process.env.ALLOW_PRIVATE_URLS === "1") return null;
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return null;
  try {
    const addrs = await dns.lookup(host, { all: true });
    if (addrs.some((a) => isPrivateIp(a.address))) return "URL resolves to a private address";
  } catch {
    // Resolution failure surfaces later as a fetch error (the proxy may resolve on our behalf).
  }
  return null;
}
