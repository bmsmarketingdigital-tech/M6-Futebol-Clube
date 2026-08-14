import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

let client: ReturnType<typeof postgres> | null = null;

export function getPostgresConnectionString(source = process.env) {
  const value =
    source.DATABASE_URL ||
    source.POSTGRES_URL ||
    source.SUPABASE_DB_URL ||
    source.SUPABASE_DATABASE_URL;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function postgresConfigured(source = process.env) {
  return getPostgresConnectionString(source) !== null;
}

export function getPostgresClient() {
  const connectionString = getPostgresConnectionString();
  if (!connectionString) {
    throw new Error(
      "Postgres/Supabase nÃ£o configurado. Defina DATABASE_URL na Vercel.",
    );
  }
  if (!client) {
    client = postgres(connectionString, {
      max: 5,
      prepare: false,
      ssl: "require",
    });
  }
  return client;
}

export function getPostgresDb() {
  return drizzle(getPostgresClient());
}

export async function checkPostgresConnection() {
  const sql = getPostgresClient();
  const [row] = await sql<{ ok: number }[]>`select 1 as ok`;
  return row?.ok === 1;
}
