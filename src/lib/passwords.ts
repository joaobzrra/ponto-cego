// Next-free on purpose: also imported by CLI scripts (seed-admin), which
// can't load the "server-only"/next/headers modules that auth.ts pulls in.
import { hash, verify } from "@node-rs/argon2";

export async function hashPassword(password: string) {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string) {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
