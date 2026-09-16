import { mkdirSync } from "node:fs";
import path from "node:path";

/** All runtime data lives under ./data (gitignored, on E:). */
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), "data");

export const SNAPSHOTS_DIR = path.join(DATA_DIR, "snapshots");
export const THUMBS_DIR = path.join(DATA_DIR, "thumbs");

export function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Resolve a stored relative path against a data root, refusing traversal. */
export function safeJoin(root: string, relative: string): string {
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`Path escapes data root: ${relative}`);
  }
  return resolved;
}
