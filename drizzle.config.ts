import { defineConfig } from "drizzle-kit";

try {
  process.loadEnvFile();
} catch {
  // .env optional; CI/prod provide real env vars
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
