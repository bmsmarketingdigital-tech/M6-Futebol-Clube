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

let postgresSchemaReady: Promise<void> | null = null;

// D1/SQLite tem ensureDatabase() (db/index.ts) rodando em toda requisição via
// getOrCreateOrganization(); o caminho hospedado (Postgres/Supabase) nunca
// passa por ali (api-auth.ts usa sessão local direto), então índices
// adicionados ao schema depois da migração inicial para o Supabase nunca
// chegaram lá -- foi assim que duas categorias "Sub-7" puderam ser
// cadastradas na mesma organização. Corrige isso da mesma forma que o D1:
// idempotente, memoizado por processo, seguro de chamar em toda requisição.
export function ensurePostgresSchema() {
  if (!postgresSchemaReady) {
    const sql = getPostgresClient();
    postgresSchemaReady = (async () => {
      // Remove duplicatas existentes antes de criar o índice único (um
      // índice único não pode ser criado sobre dados que já o violam).
      // Categorias são referenciadas só pelo nome (texto) em teams/athletes,
      // nunca pelo id de sports_categories, então apagar a duplicata mais
      // recente de cada grupo não quebra nenhum vínculo.
      await sql`
        DELETE FROM sports_categories t
        WHERE EXISTS (
          SELECT 1 FROM sports_categories t2
          WHERE t2.organization_id = t.organization_id
            AND t2.name = t.name
            AND t2.id < t.id
        )
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS sports_categories_org_name_unique
        ON sports_categories (organization_id, name)
      `;
      // DIAGNÓSTICO TEMPORÁRIO (remover depois de confirmar a causa da
      // duplicata "SUB-13"): confere se o índice está válido e se ainda
      // sobra algum grupo duplicado exato após o DELETE acima.
      try {
        const indexRows = await sql<{ indisvalid: boolean; indisready: boolean }[]>`
          SELECT indisvalid, indisready FROM pg_index
          WHERE indexrelid = 'sports_categories_org_name_unique'::regclass
        `;
        const dupeRows = await sql<{ organization_id: string; name: string; count: number }[]>`
          SELECT organization_id, name, COUNT(*)::int AS count
          FROM sports_categories
          GROUP BY organization_id, name
          HAVING COUNT(*) > 1
        `;
        console.error(
          "sports_categories diagnostic",
          JSON.stringify({ index: indexRows[0], duplicates: dupeRows }),
        );
      } catch (diagnosticError) {
        console.error("sports_categories diagnostic failed", diagnosticError);
      }
    })().catch((error) => {
      postgresSchemaReady = null;
      throw error;
    });
  }
  return postgresSchemaReady;
}
