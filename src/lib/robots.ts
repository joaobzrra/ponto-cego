import robotsParser, { type Robot } from "robots-parser";
import { fetchWithTimeout, readBodyCapped, userAgent } from "./http";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h per origin
const MAX_ROBOTS_BYTES = 512 * 1024;

const cache = new Map<string, { robot: Robot | null; fetchedAt: number }>();

async function getRobot(origin: string): Promise<Robot | null> {
  const hit = cache.get(origin);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.robot;
  let robot: Robot | null = null;
  try {
    const res = await fetchWithTimeout(`${origin}/robots.txt`, { timeoutMs: 10_000 });
    if (res.ok) {
      robot = robotsParser(`${origin}/robots.txt`, (await readBodyCapped(res, MAX_ROBOTS_BYTES)).toString("utf8"));
    }
    // 4xx/5xx → no rules available; standard practice is to proceed.
  } catch {
    // unreachable robots.txt → proceed; the outlet health system catches real outages
  }
  cache.set(origin, { robot, fetchedAt: Date.now() });
  return robot;
}

/** True when robots.txt allows us to fetch the URL (or no robots.txt exists). */
export async function robotsAllowed(url: string): Promise<boolean> {
  try {
    const origin = new URL(url).origin;
    const robot = await getRobot(origin);
    if (!robot) return true;
    return robot.isAllowed(url, userAgent()) !== false;
  } catch {
    return false; // malformed URL
  }
}
