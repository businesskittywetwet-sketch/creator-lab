import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl =
  process.env.POSTGRES_URL ??
  process.env.SUPABASE_DB_URL ??
  process.env.DATABASE_URL ??
  // Supabase transaction pooler format: postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres
  // Fallback for local dev
  "postgresql://postgres:postgres@127.0.0.1:5432/app_db";

if (!databaseUrl) {
  throw new Error("DATABASE_URL or SUPABASE_DB_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __viboroDbPool?: Pool;
};

// Supabase pooler requires no SSL by default for the transaction pooler on port 6543.
// Direct connection on port 5432 may need SSL. We use the pooler when available.
const isSupabasePooler = databaseUrl.includes("pooler.supabase.com");

export const pool =
  globalForDb.__viboroDbPool ??
  new Pool({
    connectionString: databaseUrl,
    // Supabase pooler doesn't support prepared statements in transaction mode.
    max: 10,
    ...(isSupabasePooler ? { ssl: { rejectUnauthorized: false } } : {}),
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__viboroDbPool = pool;
}

export const db = drizzle(pool);
