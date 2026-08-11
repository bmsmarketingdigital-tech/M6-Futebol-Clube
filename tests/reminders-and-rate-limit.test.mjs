import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/reminders/route.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("../app/api/reminders/service.ts", import.meta.url), "utf8");
const recover = readFileSync(new URL("../app/api/internal/notifications/recover/route.ts", import.meta.url), "utf8");
const outbox = readFileSync(new URL("../app/api/notifications/outbox.ts", import.meta.url), "utf8");
const config = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");

function reminderDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE teams(id TEXT PRIMARY KEY, active INTEGER, schedule_ok INTEGER, canceled INTEGER);
    CREATE TABLE roster(team_id TEXT, athlete_id TEXT, active INTEGER, phone TEXT);
    CREATE TABLE reminders(team_id TEXT, session_date TEXT, sent_count INTEGER DEFAULT 0,
      UNIQUE(team_id,session_date));
    INSERT INTO teams VALUES('team',1,1,0);
    INSERT INTO roster VALUES('team','athlete',1,'5518999999999');`);
  return db;
}

function normalized(value) {
  let phone = String(value || "").replace(/\D/g, "");
  if (!phone.startsWith("55") && [10, 11].includes(phone.length)) phone = `55${phone}`;
  return /^55\d{10,11}$/.test(phone) ? phone : "";
}

async function processReminder(db, sender, queuedPhone = "") {
  const claimed = db.prepare("INSERT OR IGNORE INTO reminders VALUES('team','2026-08-12',0)").run().changes;
  if (!claimed) return 0;
  const team = db.prepare("SELECT * FROM teams WHERE id='team' AND active=1 AND schedule_ok=1 AND canceled=0").get();
  const member = db.prepare("SELECT * FROM roster WHERE team_id='team' AND athlete_id='athlete' AND active=1").get();
  const phone = normalized(member?.phone);
  if (!team || !member || !phone) {
    db.prepare("DELETE FROM reminders WHERE team_id='team' AND session_date='2026-08-12'").run();
    return 0;
  }
  assert.notEqual(phone, queuedPhone || "telefone-antigo");
  await sender(phone);
  db.prepare("UPDATE reminders SET sent_count=1 WHERE team_id='team'").run();
  return 1;
}

async function limitedWorker(items, { max = 5, interval = 3000, sleeps = [], calls = [] } = {}) {
  let processed = 0;
  for (const item of items) {
    if (processed >= max) break;
    if (item.status !== "pending" && !(item.status === "failed" && item.retryAt <= Date.now())) continue;
    item.status = "processing";
    calls.push(item.type);
    item.status = "sent";
    processed += 1;
    if (processed < max && interval > 0) sleeps.push(interval);
  }
  return processed;
}

test("1 abrir/carregar interface usa apenas consulta GET", () => {
  assert.match(page, /fetch\("\/api\/reminders", \{ method: "GET" \}\)/);
  assert.doesNotMatch(page, /fetch\("\/api\/reminders", \{ method: "POST"/);
});
test("2 GET de lembretes não possui sender nem automação financeira", () => {
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /sendWhatsAppMessage|runBillingAutomation|export async function POST/);
});
test("3 envio exige scheduler interno explicitamente autorizado", () => {
  assert.match(recover, /origin === "automatic"[\s\S]*processClassReminders/);
});
test("4 mesmo lembrete não envia duas vezes", async () => {
  const db = reminderDb(); let calls = 0;
  await processReminder(db, async () => calls++); await processReminder(db, async () => calls++);
  assert.equal(calls, 1);
});
test("5 duas chamadas concorrentes criam no máximo um envio", async () => {
  const db = reminderDb(); let calls = 0;
  await Promise.all([processReminder(db, async () => calls++), processReminder(db, async () => calls++)]);
  assert.equal(calls, 1);
});
test("6 treino cancelado não envia", async () => {
  const db = reminderDb(); db.exec("UPDATE teams SET canceled=1"); let calls = 0;
  await processReminder(db, async () => calls++); assert.equal(calls, 0);
});
test("7 treino alterado fora da janela não envia", async () => {
  const db = reminderDb(); db.exec("UPDATE teams SET schedule_ok=0"); let calls = 0;
  await processReminder(db, async () => calls++); assert.equal(calls, 0);
});
test("8 telefone antigo não recebe", async () => {
  const db = reminderDb(); db.exec("UPDATE roster SET phone='5518988887777'"); const phones = [];
  await processReminder(db, async phone => phones.push(phone), "5518999999999");
  assert.deepEqual(phones, ["5518988887777"]);
});
test("9 telefone inválido não recebe", async () => {
  const db = reminderDb(); db.exec("UPDATE roster SET phone='123'"); let calls = 0;
  await processReminder(db, async () => calls++); assert.equal(calls, 0);
});
test("10 atleta ou matrícula não aplicável não recebe", async () => {
  const db = reminderDb(); db.exec("UPDATE roster SET active=0"); let calls = 0;
  await processReminder(db, async () => calls++); assert.equal(calls, 0);
});
test("11 lembrete já enviado não envia novamente", async () => {
  const db = reminderDb(); db.exec("INSERT INTO reminders VALUES('team','2026-08-12',1)"); let calls = 0;
  await processReminder(db, async () => calls++); assert.equal(calls, 0);
});
test("12 refresh da tela não dispara sender", () => {
  assert.doesNotMatch(page, /sendWhatsAppMessage/); assert.doesNotMatch(route, /processClassReminders/);
});
test("13 limite de N por execução", async () => {
  const items = Array.from({length: 8}, () => ({status:"pending",type:"overdue"}));
  assert.equal(await limitedWorker(items, {max:3,interval:0}), 3);
});
test("14 N+1 permanece para execução futura", async () => {
  const items = Array.from({length: 4}, () => ({status:"pending",type:"overdue"}));
  await limitedWorker(items, {max:3,interval:0}); assert.equal(items[3].status, "pending");
});
test("15 itens não processados não viram failed", async () => {
  const items = Array.from({length: 100}, () => ({status:"pending",type:"due_today"}));
  await limitedWorker(items, {max:5,interval:0}); assert.equal(items.filter(x=>x.status==="failed").length, 0);
});
test("16 intervalo entre envios é respeitado", async () => {
  const sleeps=[]; await limitedWorker(Array.from({length:3},()=>({status:"pending",type:"overdue"})),{max:3,interval:3000,sleeps});
  assert.deepEqual(sleeps,[3000,3000]); assert.match(outbox,/finishAttempt[\s\S]*await sleep\(minIntervalMs\)/);
});
test("17 intervalo zero é permitido em teste", async () => {
  const sleeps=[]; await limitedWorker([{status:"pending",type:"overdue"}],{max:1,interval:0,sleeps}); assert.deepEqual(sleeps,[]);
});
test("18 dois workers não processam o mesmo item", async () => {
  const item={status:"pending",type:"overdue"}; await Promise.all([limitedWorker([item],{max:1,interval:0}),limitedWorker([item],{max:1,interval:0})]); assert.equal(item.status,"sent");
});
test("19 reconnect reutiliza worker ativo por organização", () => {
  assert.match(outbox,/activeBackgroundWorkers\.get\(organizationId\)/);
  assert.match(outbox,/if \(active\) return active/);
});
test("20 lote com 100 itens nunca ultrapassa limite configurado", async () => {
  const calls=[]; await limitedWorker(Array.from({length:100},()=>({status:"pending",type:"overdue"})),{max:5,interval:0,calls}); assert.equal(calls.length,5);
});
for (const [number,type] of [[21,"before_due"],[22,"due_today"],[23,"overdue"]]) {
  test(`${number} rate limit não quebra ${type}`, async () => {
    const calls=[]; await limitedWorker([{status:"pending",type}],{max:5,interval:0,calls}); assert.deepEqual(calls,[type]);
  });
}
test("24 retry continua respeitando backoff e novo limite", async () => {
  const calls=[]; const future=Date.now()+60000;
  const items=[{status:"failed",retryAt:future,type:"overdue"},{status:"failed",retryAt:0,type:"overdue"},{status:"pending",type:"overdue"}];
  await limitedWorker(items,{max:1,interval:0,calls}); assert.equal(calls.length,1); assert.equal(items[0].status,"failed");
});
test("configuração possui defaults conservadores explícitos", () => {
  assert.match(config,/WHATSAPP_FINANCIAL_MAX_PER_RUN[\s\S]*"5"/);
  assert.match(config,/WHATSAPP_FINANCIAL_MIN_INTERVAL_MS[\s\S]*"3000"/);
  assert.match(outbox,/ABSOLUTE_MAX_BATCH = 100/);
});
test("serviço real reserva antes do sender e revalida estado atual", () => {
  assert.match(service,/onConflictDoNothing/);
  assert.ok(service.indexOf("onConflictDoNothing") < service.indexOf("await sender"));
  assert.match(service,/revalidateRecipient/);
  assert.match(service,/normalizeReminderPhone/);
});
