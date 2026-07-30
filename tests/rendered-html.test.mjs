import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("keeps every operational module available from the dashboard", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");
  const modules = [
    "Atletas",
    "Turmas",
    "Presença",
    "QR e entrada",
    "Financeiro",
    "Treinos",
    "Avaliações",
    "Comunicação",
  ];

  for (const moduleName of modules) {
    assert.match(page, new RegExp(`label: "${moduleName}"`));
  }

  for (const component of [
    "FinanceManagement",
    "EvaluationManagement",
    "TrainingManagement",
    "CommunicationManagement",
    "CheckInManagement",
  ]) {
    assert.ok(page.includes(`import { ${component} }`));
    assert.match(page, new RegExp(`<${component}`));
  }
});

test("protects persisted APIs and keeps the complete migration history", async () => {
  const routePaths = [
    "app/api/athletes/route.ts",
    "app/api/teams/route.ts",
    "app/api/finance/summary/route.ts",
    "app/api/evaluations/route.ts",
    "app/api/trainings/route.ts",
    "app/api/communications/route.ts",
    "app/api/check-in/route.ts",
  ];

  for (const routePath of routePaths) {
    const route = await readFile(new URL(routePath, root), "utf8");
    assert.match(route, /getApiContext/);
    assert.match(route, /export const dynamic = "force-dynamic"/);
  }

  const migrations = (await readdir(new URL("drizzle/", root)))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();
  assert.equal(migrations.length, 9);
  assert.match(migrations[0], /^0000_/);
  assert.match(migrations.at(-1) ?? "", /^0008_/);
});
