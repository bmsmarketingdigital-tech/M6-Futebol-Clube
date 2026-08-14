import { readFile } from "node:fs/promises";
import postgres from "postgres";

const CRITICAL_TABLES = [
  "organizations",
  "local_users",
  "organization_members",
  "athletes",
  "teams",
  "team_athletes",
  "payments",
  "payment_transactions",
  "billing_notifications",
  "notification_outbox",
  "notification_attempts",
  "athlete_billing_month_reservations",
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`Variavel obrigatoria ausente: ${name}`);
  return value.trim();
}

function readArg(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
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
  max: 1,
  prepare: false,
  ssl: "require",
});

const results = {};
let ok = true;

try {
  for (const table of payload.tableOrder) {
    const expected = Number(payload.counts?.[table] ?? 0);
    const [{ total }] = await sql.unsafe(
      `SELECT COUNT(*)::int AS total FROM ${quoteIdentifier(table)}`,
    );
    const actual = Number(total);
    const matches = actual === expected;
    results[table] = { expected, actual, matches };
    if (!matches && CRITICAL_TABLES.includes(table)) ok = false;
  }

  const legacyBilling = await sql`
    SELECT
      COUNT(*) FILTER (WHERE status='sent')::int AS sent,
      COUNT(*) FILTER (WHERE status='failed')::int AS failed,
      COUNT(*) FILTER (WHERE status='sent' AND sent_at IS NOT NULL)::int AS sent_with_sent_at
    FROM billing_notifications
  `;
  const outbox = await sql`
    SELECT status, COUNT(*)::int AS total
    FROM notification_outbox
    GROUP BY status
    ORDER BY status
  `;
  const attempts = await sql`
    SELECT COUNT(*)::int AS total
    FROM notification_attempts
  `;

  console.log(
    JSON.stringify(
      {
        ok,
        source: payload.source,
        exportedAt: payload.exportedAt,
        criticalTables: CRITICAL_TABLES,
        counts: results,
        audit: {
          billingNotifications: legacyBilling[0],
          notificationOutboxByStatus: outbox,
          notificationAttempts: attempts[0]?.total ?? 0,
        },
      },
      null,
      2,
    ),
  );

  if (!ok) process.exitCode = 1;
} finally {
  await sql.end();
}
