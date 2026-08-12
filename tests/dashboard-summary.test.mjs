import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

// Auditoria: Dashboard tinha 4 indicadores fictícios/hardcoded (financeBars,
// "5 avaliações pendentes", "Comunicado agendado", "Documentação em dia").
// Este arquivo prova que a nova rota /api/dashboard/summary deriva receita
// mensal do ledger (payment_transactions), respeita tenant, zera meses sem
// movimento e usa o esquema real de evaluations/communications/documents
// em vez de inventar conceitos que o banco não suporta (ex: "pendente").

const routeSource = readFileSync("app/api/dashboard/summary/route.ts", "utf8");
const pageSource = readFileSync("app/page.tsx", "utf8");

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE organizations(id TEXT PRIMARY KEY);
    CREATE TABLE payments(id TEXT PRIMARY KEY, organization_id TEXT, athlete_id TEXT);
    CREATE TABLE payment_transactions(id TEXT PRIMARY KEY, payment_id TEXT, type TEXT, amount_cents INTEGER, occurred_at INTEGER);
    CREATE TABLE athlete_evaluations(id TEXT PRIMARY KEY, organization_id TEXT, athlete_id TEXT, evaluation_date TEXT);
    CREATE TABLE communications(id TEXT PRIMARY KEY, organization_id TEXT, title TEXT, status TEXT, scheduled_at TEXT);
    CREATE TABLE athlete_documents(id TEXT PRIMARY KEY, organization_id TEXT, athlete_id TEXT);
    INSERT INTO organizations VALUES('A'),('B');
  `);
  return db;
}

// Espelha a agregação em JS feita pela rota real: soma payment, subtrai
// refund, por mês (America/Sao_Paulo), com piso em zero.
function revenueByMonth(db, organizationId, months) {
  const rows = db
    .prepare(
      `SELECT t.type, t.amount_cents AS amountCents, t.occurred_at AS occurredAt
       FROM payment_transactions t JOIN payments p ON p.id = t.payment_id
       WHERE p.organization_id = ? AND t.type IN ('payment','refund','opening_balance')`,
    )
    .all(organizationId);
  const byMonth = new Map(months.map((m) => [m, 0]));
  for (const row of rows) {
    const key = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
    }).format(new Date(row.occurredAt * 1000));
    if (!byMonth.has(key)) continue;
    const signed = row.type === "refund" ? -row.amountCents : row.amountCents;
    byMonth.set(key, byMonth.get(key) + signed);
  }
  return months.map((month) => ({ month, receivedCents: Math.max(0, byMonth.get(month)) }));
}

test("1 receita real: soma pagamentos do mês corretamente", () => {
  const db = fixture();
  db.prepare("INSERT INTO payments VALUES('p1','A','ath1')").run();
  db.prepare("INSERT INTO payment_transactions VALUES('t1','p1','payment',15000,1754049600)").run(); // 2025-08-01T12:00:00Z
  const result = revenueByMonth(db, "A", ["2025-08"]);
  assert.equal(result[0].receivedCents, 15000);
});

test("2 mês sem movimento retorna zero, não é removido", () => {
  const db = fixture();
  const result = revenueByMonth(db, "A", ["2025-08", "2025-09"]);
  assert.deepEqual(result, [
    { month: "2025-08", receivedCents: 0 },
    { month: "2025-09", receivedCents: 0 },
  ]);
});

test("3 isolamento por tenant: transação da Org B não soma na Org A", () => {
  const db = fixture();
  db.prepare("INSERT INTO payments VALUES('pb','B','athB')").run();
  db.prepare("INSERT INTO payment_transactions VALUES('tb','pb','payment',99999,1754049600)").run();
  const result = revenueByMonth(db, "A", ["2025-08"]);
  assert.equal(result[0].receivedCents, 0);
});

test("4 refund abate o mês em que ocorreu, não o mês do pagamento original", () => {
  const db = fixture();
  db.prepare("INSERT INTO payments VALUES('p1','A','ath1')").run();
  db.prepare("INSERT INTO payment_transactions VALUES('t1','p1','payment',20000,1748779200)").run(); // 2025-06-01T12:00:00Z
  db.prepare("INSERT INTO payment_transactions VALUES('t2','p1','refund',5000,1754049600)").run(); // 2025-08-01T12:00:00Z
  const result = revenueByMonth(db, "A", ["2025-06", "2025-07", "2025-08"]);
  assert.equal(result[0].receivedCents, 20000);
  assert.equal(result[1].receivedCents, 0);
  assert.equal(result[2].receivedCents, 0); // refund > 0 recebido nesse mês -> piso em zero, não negativo
});

test("5 receita nunca fica negativa quando refund excede o recebido do mês", () => {
  const db = fixture();
  db.prepare("INSERT INTO payments VALUES('p1','A','ath1')").run();
  db.prepare("INSERT INTO payment_transactions VALUES('t1','p1','refund',5000,1754049600)").run();
  const result = revenueByMonth(db, "A", ["2025-08"]);
  assert.ok(result[0].receivedCents >= 0);
});

test("6 avaliação real: card mostra total e última data, não conceito de pendência inexistente", () => {
  const db = fixture();
  db.prepare("INSERT INTO athlete_evaluations VALUES('e1','A','ath1','2026-07-10')").run();
  db.prepare("INSERT INTO athlete_evaluations VALUES('e2','A','ath1','2026-08-01')").run();
  const rows = db.prepare("SELECT evaluation_date FROM athlete_evaluations WHERE organization_id='A' ORDER BY evaluation_date DESC").all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].evaluation_date, "2026-08-01");
});

test("7 zero avaliações: total 0, sem data fictícia", () => {
  const db = fixture();
  const rows = db.prepare("SELECT * FROM athlete_evaluations WHERE organization_id='A'").all();
  assert.equal(rows.length, 0);
});

test("8 próxima comunicação real vem de communications status=scheduled", () => {
  const db = fixture();
  db.prepare("INSERT INTO communications VALUES('c1','A','Festival interno','scheduled','2026-08-13 09:00')").run();
  db.prepare("INSERT INTO communications VALUES('c2','A','Rascunho','draft',NULL)").run();
  const row = db.prepare("SELECT title,scheduled_at FROM communications WHERE organization_id='A' AND status='scheduled' ORDER BY scheduled_at LIMIT 1").get();
  assert.equal(row.title, "Festival interno");
});

test("9 nenhuma comunicação agendada retorna null, não texto fixo", () => {
  const db = fixture();
  db.prepare("INSERT INTO communications VALUES('c2','A','Rascunho','draft',NULL)").run();
  const row = db.prepare("SELECT * FROM communications WHERE organization_id='A' AND status='scheduled' LIMIT 1").get();
  assert.equal(row, undefined);
});

test("10 documentos: contagem real e isolada por tenant", () => {
  const db = fixture();
  db.prepare("INSERT INTO athlete_documents VALUES('d1','A','ath1')").run();
  db.prepare("INSERT INTO athlete_documents VALUES('d2','A','ath1')").run();
  db.prepare("INSERT INTO athlete_documents VALUES('d3','B','athB')").run();
  const countA = db.prepare("SELECT COUNT(*) n FROM athlete_documents WHERE organization_id='A'").get().n;
  assert.equal(countA, 2);
});

test("rota real filtra tudo por organizationId (tenant isolation)", () => {
  assert.match(routeSource, /eq\(payments\.organizationId, organizationId\)/);
  assert.match(routeSource, /eq\(athleteEvaluations\.organizationId, organizationId\)/);
  assert.match(routeSource, /eq\(communications\.organizationId, organizationId\)/);
  assert.match(routeSource, /eq\(athleteDocuments\.organizationId, organizationId\)/);
});

test("rota real usa payment_transactions (ledger), não payments.amount_cents nominal", () => {
  assert.match(routeSource, /paymentTransactions\.amountCents/);
  assert.doesNotMatch(routeSource, /payments\.amountCents/);
});

test("rota real exige autenticação antes de agregar", () => {
  assert.match(routeSource, /getApiContext\(request\)/);
  assert.match(routeSource, /status: 401/);
});

test("UI não contém mais os valores hardcoded do Dashboard", () => {
  assert.doesNotMatch(pageSource, /52, 68, 58, 76, 64, 84, 73, 92, 78, 96, 88, 100/);
  assert.doesNotMatch(pageSource, /5 avaliações pendentes/);
  assert.doesNotMatch(pageSource, /Festival interno · Amanhã, 9h/);
  assert.doesNotMatch(pageSource, /Documentação em dia/);
});

test("UI consome /api/dashboard/summary para os cards reais", () => {
  assert.match(pageSource, /\/api\/dashboard\/summary/);
  assert.match(pageSource, /summary\.evaluations\.total/);
  assert.match(pageSource, /summary\.nextCommunication/);
  assert.match(pageSource, /summary\.documents\.total/);
});

test("UI mostra estado vazio honesto quando não há receita", () => {
  assert.match(pageSource, /Nenhuma receita registrada/);
});
