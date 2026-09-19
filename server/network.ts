import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { createRequire } from "node:module";
const robotsParser = createRequire(import.meta.url)("robots-parser") as (
  url: string,
  body: string,
) => { isAllowed: (url: string, agent: string) => boolean | undefined };

const USER_AGENT = "VisualCampusBot/1.0";
export function isPublicAddress(address: string): boolean {
  try {
    let parsed = ipaddr.parse(address);
    if (
      parsed.kind() === "ipv6" &&
      (parsed as ipaddr.IPv6).isIPv4MappedAddress()
    )
      parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}
export function validateUrl(raw: string): URL {
  const u = new URL(raw);
  if (
    !["https:", "http:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    (u.port && !["80", "443"].includes(u.port))
  )
    throw new Error("Blocked URL");
  const hostname = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".internal")
  )
    throw new Error("Blocked hostname");
  if (ipaddr.isValid(hostname) && !isPublicAddress(hostname))
    throw new Error("Blocked address");
  return u;
}
export type Download = {
  body: Buffer;
  contentType: string;
  finalUrl: string;
  status: number;
};

// Resolve once, reject all private answers, and pin the socket to the vetted address.
// Redirects are revalidated; TLS still verifies the original hostname.
async function rawGet(
  raw: string,
  signal: AbortSignal,
  maxBytes: number,
): Promise<Download & { redirect?: string }> {
  signal.throwIfAborted();
  const url = validateUrl(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let onAbort: () => void = () => {};
  const addresses = await Promise.race([
    lookup(host, { all: true }),
    new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    }),
  ]).finally(() => signal.removeEventListener("abort", onAbort));
  signal.throwIfAborted();
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new Error("Blocked DNS answer");
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method: "GET",
        signal,
        agent: false,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "image/jpeg,image/png,image/webp,text/html,text/plain;q=0.8",
          "Accept-Encoding": "identity",
        },
        lookup: (_hostname, options, callback) =>
          options.all
            ? callback(null, [
                { address: address.address, family: address.family },
              ])
            : callback(null, address.address, address.family),
      },
      (res) => {
        const status = res.statusCode ?? 500;
        if (
          [301, 302, 303, 307, 308].includes(status) &&
          res.headers.location
        ) {
          res.destroy();
          resolve({
            body: Buffer.alloc(0),
            contentType: "",
            finalUrl: url.href,
            status,
            redirect: new URL(res.headers.location, url).href,
          });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        if (Number(res.headers["content-length"] ?? 0) > maxBytes) {
          res.destroy();
          reject(new Error("Response too large"));
          return;
        }
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy(new Error("Response too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () =>
          resolve({
            body: Buffer.concat(chunks),
            contentType: String(res.headers["content-type"] ?? "")
              .split(";")[0]
              .toLowerCase(),
            finalUrl: url.href,
            status,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}
const robotCache = new Map<
  string,
  { until: number; value: Promise<ReturnType<typeof robotsParser> | null> }
>();
async function allowed(url: URL, signal: AbortSignal): Promise<boolean> {
  let cached = robotCache.get(url.origin);
  if (!cached || cached.until < Date.now()) {
    const value = (async () => {
      let target = new URL("/robots.txt", url).href;
      for (let i = 0; i < 3; i++) {
        const response = await rawGet(target, signal, 128000);
        if (response.redirect) {
          target = response.redirect;
          continue;
        }
        if ([404, 410].includes(response.status))
          return robotsParser(target, "");
        if (response.status !== 200) return null;
        return robotsParser(target, response.body.toString("utf8"));
      }
      return null;
    })().catch(() => null);
    if (robotCache.size > 500) robotCache.clear();
    cached = { until: Date.now() + 300000, value };
    robotCache.set(url.origin, cached);
  }
  const rules = await cached.value;
  return rules !== null && rules.isAllowed(url.href, USER_AGENT) !== false;
}
export async function downloadPublic(
  raw: string,
  parent: AbortSignal,
  kind: "image" | "page",
): Promise<Download> {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(6000)]);
  let target = raw;
  for (let redirect = 0; redirect < 4; redirect++) {
    const url = validateUrl(target);
    if (!(await allowed(url, signal)))
      throw new Error(
        "Source does not allow automated access or robots policy unavailable",
      );
    const result = await rawGet(
      url.href,
      signal,
      kind === "image" ? 6 * 1024 * 1024 : 512 * 1024,
    );
    if (result.redirect) {
      target = result.redirect;
      continue;
    }
    if (result.status !== 200) throw new Error("Source unavailable");
    const supported =
      kind === "image"
        ? ["image/jpeg", "image/png", "image/webp"]
        : ["text/html", "application/xhtml+xml"];
    if (!supported.includes(result.contentType))
      throw new Error("Unsupported content type");
    return result;
  }
  throw new Error("Too many redirects");
}
export function pageContainsImage(html: string, imageUrl: string): boolean {
  const normalized = html.replaceAll("&amp;", "&").replaceAll("\\/", "/");
  const url = new URL(imageUrl);
  return (
    normalized.includes(url.href) ||
    (url.pathname.length > 12 && normalized.includes(url.pathname))
  );
}
export function plainText(html: string): string {
  return html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 5000);
}
