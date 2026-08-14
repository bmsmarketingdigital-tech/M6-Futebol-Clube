import { readFile } from "node:fs/promises";
import postgres from "postgres";

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`Variavel obrigatoria ausente: ${name}`);
  return value.trim();
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function readArg(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

const input = readArg("input");
if (!input) {
  throw new Error("Informe --input=caminho/do/export.json");
}

const payload = JSON.parse(await readFile(input, "utf8"));
if (payload.format !== "m6-supabase-export-v1") {
  throw new Error("Arquivo de exportacao nao reconhecido.");
}

const sql = postgres(requireEnv("DATABASE_URL"), {
  connect_timeout: 15,
  max: 1,
  prepare: false,
  ssl: "require",
});

const dryRun = process.argv.includes("--dry-run");
const summary = {};

try {
  await sql.begin(async (tx) => {
    await tx`set local statement_timeout = '15s'`;
    for (const table of payload.tableOrder) {
      const rows = payload.tables[table] || [];
      summary[table] = { expected: rows.length, inserted: 0 };
      console.error(`[supabase:import] ${dryRun ? "dry-run " : ""}tabela ${table}: ${rows.length} registro(s)`);
      if (!rows.length) {
        console.error(`[supabase:import] tabela ${table}: vazia, pulando`);
        continue;
      }

      const columns = Object.keys(rows[0]);
      const columnSql = columns.map(quoteIdentifier).join(", ");
      const valuesSql = columns.map((_, index) => `$${index + 1}`).join(", ");
      const statement = `INSERT INTO ${quoteIdentifier(table)} (${columnSql}) VALUES (${valuesSql}) ON CONFLICT DO NOTHING`;

      for (const row of rows) {
        await tx.unsafe(statement, columns.map((column) => row[column]));
        summary[table].inserted += 1;
      }
      console.error(`[supabase:import] tabela ${table}: ${summary[table].inserted}/${rows.length}`);
    }

    if (dryRun) {
      throw new Error("__M6_DRY_RUN_ROLLBACK__");
    }
  });
} catch (error) {
  if (!(error instanceof Error && error.message === "__M6_DRY_RUN_ROLLBACK__")) {
    throw error;
  }
}

await sql.end();

console.log(
  JSON.stringify(
    {
      ok: true,
      dryRun,
      source: payload.source,
      exportedAt: payload.exportedAt,
      summary,
    },
    null,
    2,
  ),
);
