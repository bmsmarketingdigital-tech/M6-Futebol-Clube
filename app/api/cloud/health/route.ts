import { checkPostgresConnection, postgresConfigured } from "../../../../db/postgres";
import { getRuntimeEnv } from "../../runtime-env";

export const dynamic = "force-dynamic";

function configured(name: string) {
  const value = getRuntimeEnv()[name];
  return typeof value === "string" && value.trim().length > 0;
}

export async function GET() {
  const hasDatabase = postgresConfigured();
  let databaseReachable: boolean | null = null;
  let databaseError: string | null = null;

  if (hasDatabase) {
    try {
      databaseReachable = await checkPostgresConnection();
    } catch (error) {
      databaseReachable = false;
      databaseError = error instanceof Error ? error.message : "Falha ao conectar no Postgres.";
    }
  }

  return Response.json({
    ok: hasDatabase && databaseReachable === true,
    runtime: "vercel-supabase-preflight",
    databaseConfigured: hasDatabase,
    databaseReachable,
    supabaseUrlConfigured: configured("SUPABASE_URL") || configured("NEXT_PUBLIC_SUPABASE_URL"),
    evolutionConfigured:
      configured("EVOLUTION_API_URL") &&
      configured("EVOLUTION_API_KEY") &&
      configured("EVOLUTION_API_INSTANCE"),
    asaasConfigured: configured("ASAAS_API_KEY"),
    databaseError,
  });
}
