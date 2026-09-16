import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Singleton across Next.js dev hot-reloads and shared by the worker.
const globalForDb = globalThis as unknown as {
  pcPool?: Pool;
  pcDb?: NodePgDatabase<typeof schema>;
};

function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return new Pool({ connectionString: url, max: 10 });
}

export const pool = (globalForDb.pcPool ??= createPool());
export const db = (globalForDb.pcDb ??= drizzle(pool, { schema }));
export * as tables from "./schema";
