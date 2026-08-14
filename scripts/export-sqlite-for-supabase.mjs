import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const OFFICIAL_SQLITE =
  "C:\\SISTEMA_ESCOLA_DE_FUTEBOL\\.wrangler\\state\\v3\\d1\\miniflare-D1DatabaseObject\\faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";

const TABLES = [
  "organizations",
  "local_users",
  "organization_members",
  "local_auth_sessions",
  "sports_categories",
  "athletes",
  "athlete_documents",
  "teams",
  "team_athletes",
  "attendance_sessions",
  "attendance_records",
  "athlete_check_ins",
  "class_reminders",
  "athlete_evaluations",
  "training_sessions",
  "training_drills",
  "communications",
  "communication_recipients",
  "billing_plans",
  "athlete_billing",
  "billing_combos",
  "athlete_combos",
  "payments",
  "athlete_combo_installments",
  "athlete_combo_coverage",
  "athlete_billing_month_reservations",
  "payment_transactions",
  "billing_notification_settings",
  "billing_notifications",
  "notification_outbox",
  "notification_attempts",
  "expenses",
  "license_state",
];

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function tableExists(db, table) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
      .get(table),
  );
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

const source = resolve(readArg("source", OFFICIAL_SQLITE));
const output = resolve(
  readArg(
    "output",
    "backups/supabase-export/m6-supabase-export.json",
  ),
);

const db = new DatabaseSync(source, { readOnly: true });
const integrity = db.prepare("PRAGMA integrity_check").get();
const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
if (integrity.integrity_check !== "ok") {
  throw new Error(`SQLite integrity_check falhou: ${integrity.integrity_check}`);
}
if (foreignKeys.length) {
  throw new Error(`SQLite foreign_key_check falhou: ${foreignKeys.length} problema(s).`);
}

const exportedAt = new Date().toISOString();
const tables = {};
const counts = {};
const missingTables = [];

for (const table of TABLES) {
  if (!tableExists(db, table)) {
    missingTables.push(table);
    tables[table] = [];
    counts[table] = 0;
    continue;
  }
  const rows = db.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all();
  tables[table] = rows;
  counts[table] = rows.length;
}

await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  JSON.stringify(
    {
      source,
      exportedAt,
      format: "m6-supabase-export-v1",
      tableOrder: TABLES,
      counts,
      missingTables,
      tables,
    },
    null,
    2,
  ),
);

console.log(
  JSON.stringify(
    {
      ok: true,
      output,
      exportedAt,
      counts,
      missingTables,
    },
    null,
    2,
  ),
);
