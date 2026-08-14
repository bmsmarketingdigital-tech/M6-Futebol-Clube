import { readFile } from "node:fs/promises";

function readArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function stripSqlComments(sql) {
  return sql.replace(/--.*$/gm, "");
}

function parseCreateTables(sql) {
  const tables = new Map();
  const cleaned = stripSqlComments(sql);
  const pattern = /create\s+table\s+("?[\w]+"?)\s*\(([\s\S]*?)\);/gi;
  let match;
  while ((match = pattern.exec(cleaned))) {
    const table = match[1].replaceAll('"', "");
    const body = match[2];
    const columns = [];
    for (const rawLine of body.split(/\n/)) {
      const line = rawLine.trim().replace(/,$/, "");
      if (!line || /^(primary|foreign|unique|check|constraint)\b/i.test(line)) continue;
      const column = line.match(/^"?([a-zA-Z_][\w]*)"?\s+/)?.[1];
      if (column) columns.push(column);
    }
    tables.set(table, columns);
  }
  return tables;
}

const exportPath = readArg(
  "export",
  "backups/supabase-export/m6-supabase-export.json",
);
const migrationPath = readArg(
  "migration",
  "supabase/migrations/0001_initial_schema.sql",
);

const [exportPayload, migrationSql] = await Promise.all([
  readFile(exportPath, "utf8").then(JSON.parse),
  readFile(migrationPath, "utf8"),
]);

if (exportPayload.format !== "m6-supabase-export-v1") {
  throw new Error("Arquivo de exportacao nao reconhecido.");
}

const migrationTables = parseCreateTables(migrationSql);
const report = {};
let ok = true;

for (const table of exportPayload.tableOrder) {
  const rows = exportPayload.tables[table] || [];
  const exportedColumns = rows[0] ? Object.keys(rows[0]) : [];
  const migrationColumns = migrationTables.get(table) || [];
  const missingInMigration = exportedColumns.filter(
    (column) => !migrationColumns.includes(column),
  );
  const absentInExport = migrationColumns.filter(
    (column) => !exportedColumns.includes(column),
  );
  if (missingInMigration.length) ok = false;
  report[table] = {
    exportedColumns,
    migrationColumns,
    missingInMigration,
    absentInExport,
  };
}

console.log(JSON.stringify({ ok, report }, null, 2));
if (!ok) process.exitCode = 1;
