import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_REDIRECTS = 5;

export function userAgent(): string {
  return (
    process.env.USER_AGENT ??
    "PontoCegoBot/0.1 (news aggregator; +https://pontocego.app)"
  );
}

function blockedIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    // 192.0.0.0/24 (IETF) and 192.0.2.0/24 (TEST-NET-1) only — the rest of
    // 192.0.0.0/16 is public (192.0.64.0/18 is WordPress VIP: Veja, CNN, JP).
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function blockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.") ||
    /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(normalized)
  );
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? blockedIpv4(address) : family === 6 ? blockedIpv6(address) : true;
}

export async function assertPublicHttpUrl(input: string): Promise<URL> {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP(S) URLs are allowed");
  }
  if (url.username || url.password) throw new Error("Credentials in URLs are not allowed");
  if (url.port && !["80", "443"].includes(url.port)) {
    throw new Error("Only standard HTTP(S) ports are allowed");
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new Error("URL resolves to a non-public address");
  }
  pinAddresses(url.hostname, addresses);
  return url;
}

/**
 * Validated addresses per hostname. The connect step below resolves ONLY from
 * this map, so the address the socket opens is the one that passed
 * isBlockedAddress — a DNS record that flips to 127.0.0.1 or a docker-network
 * IP between the check and the connect (rebinding) has nowhere to go.
 * Overwritten on every validation; a host missing here fails closed.
 */
const pinned = new Map<string, Array<{ address: string; family: number }>>();

export function pinAddresses(
  hostname: string,
  addresses: Array<{ address: string; family: number }>,
): void {
  pinned.set(hostname.toLowerCase(), addresses.map(({ address, family }) => ({ address, family })));
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | Array<{ address: string; family: number }>,
  family?: number,
) => void;

/** net.connect-shaped lookup that never touches DNS: answers from `pinned` only. */
export function pinnedLookup(
  hostname: string,
  options: { all?: boolean } | LookupCallback,
  callback?: LookupCallback,
): void {
  const cb = (typeof options === "function" ? options : callback) as LookupCallback;
  const all = typeof options === "object" && options !== null && options.all === true;
  const list = pinned.get(hostname.toLowerCase());
  if (!list || list.length === 0) {
    const err: NodeJS.ErrnoException = new Error(`No validated address for ${hostname}`);
    err.code = "ENOTFOUND";
    cb(err, all ? [] : "", 0);
    return;
  }
  if (all) cb(null, list);
  else cb(null, list[0].address, list[0].family);
}

const pinnedAgent = new Agent({
  connect: { timeout: 10_000, lookup: pinnedLookup as never },
});

/** SSRF-safe fetch with bounded redirects, timeout and identifying User-Agent. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number; maxRedirects?: number } = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, maxRedirects = DEFAULT_MAX_REDIRECTS, ...rest } = init;
  let current = url;
  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    const safeUrl = await assertPublicHttpUrl(current);
    const res = (await undiciFetch(safeUrl, {
      ...(rest as UndiciRequestInit),
      dispatcher: pinnedAgent,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": userAgent(), ...(rest.headers as Record<string, string>) },
    })) as unknown as Response;
    if (![301, 302, 303, 307, 308].includes(res.status)) return res;
    const location = res.headers.get("location");
    if (!location) return res;
    if (redirects === maxRedirects) throw new Error("Too many redirects");
    current = new URL(location, safeUrl).toString();
  }
  throw new Error("Too many redirects");
}

/**
 * Read a response body while enforcing a byte cap DURING the read, not after.
 * `Content-Length` is advisory (chunked responses omit it) and `arrayBuffer()`
 * buffers everything before any length check can run, so a fast large body
 * from an outlet would land whole in worker memory. Throws once `maxBytes` is
 * exceeded and cancels the stream so the socket is released.
 */
export async function readBodyCapped(
  res: { headers: Headers; body: ReadableStream<Uint8Array> | null },
  maxBytes: number,
): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error(`Body exceeds ${maxBytes} bytes (declared)`);
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`Body exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * True only for absolute http(s) URLs. Article links come from outlet feeds
 * and are rendered as clickable hrefs, so a `javascript:` or `data:` value
 * must be refused at ingestion AND at render (defence in depth).
 */
export function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
