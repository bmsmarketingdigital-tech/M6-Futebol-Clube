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
    "Cartões QR",
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
    "app/api/categories/route.ts",
  ];

  for (const routePath of routePaths) {
    const route = await readFile(new URL(routePath, root), "utf8");
    assert.match(route, /getApiContext/);
    assert.match(route, /export const dynamic = "force-dynamic"/);
  }

  const migrations = (await readdir(new URL("drizzle/", root)))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();
  assert.equal(migrations.length, 22);
  assert.match(migrations[0], /^0000_/);
  assert.match(migrations.at(-1) ?? "", /^0021_/);
});

test("keeps monthly billing automation configurable and idempotent", async () => {
  const [automation, settingsRoute, schema, financeUi, reminders] =
    await Promise.all([
      readFile(
        new URL("app/api/finance/billing-automation.ts", root),
        "utf8",
      ),
      readFile(
        new URL(
          "app/api/finance/notifications/settings/route.ts",
          root,
        ),
        "utf8",
      ),
      readFile(new URL("db/schema.ts", root), "utf8"),
      readFile(new URL("app/FinanceManagement.tsx", root), "utf8"),
      readFile(new URL("app/api/reminders/route.ts", root), "utf8"),
    ]);

  assert.match(automation, /generateMonthlyCharges/);
  assert.match(automation, /before_due/);
  assert.match(automation, /due_today/);
  assert.match(automation, /overdue/);
  assert.match(automation, /idempotencyKey: `billing:/);
  assert.match(automation, /processNotificationQueue/);
  assert.match(settingsRoute, /beforeDueDays/);
  assert.match(settingsRoute, /overdueDays/);
  assert.match(schema, /billing_notification_settings/);
  assert.match(schema, /billing_notifications_payment_type_unique/);
  assert.match(schema, /notification_outbox_idempotency_unique/);
  assert.match(financeUi, /Lembretes de mensalidade pelo WhatsApp/);
  assert.match(reminders, /getClassReminderStatus/);
  assert.doesNotMatch(reminders, /sendWhatsAppMessage|runBillingAutomation|export async function POST/);
});
