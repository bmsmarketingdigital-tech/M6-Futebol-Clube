import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const migration = readFileSync(new URL("../drizzle/0015_payment_transactions.sql", import.meta.url), "utf8")
  .replaceAll("--> statement-breakpoint", "");

function database({ amount = 10000, paid = 0, status = "open" } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE organizations(id TEXT PRIMARY KEY);
    CREATE TABLE athletes(id TEXT PRIMARY KEY,organization_id TEXT,financial_status TEXT,updated_at INTEGER);
    CREATE TABLE payments(id TEXT PRIMARY KEY,organization_id TEXT,athlete_id TEXT,reference_month TEXT,
      amount_cents INTEGER,due_date TEXT,paid_at INTEGER,paid_amount_cents INTEGER,payment_method TEXT,
      notes TEXT,external_payment_id TEXT,status TEXT,created_at INTEGER,updated_at INTEGER);
    INSERT INTO organizations VALUES('org');
    INSERT INTO athletes VALUES('athlete','org','pending',1);
    INSERT INTO payments VALUES('charge','org','athlete','2026-08',${amount},'2026-08-10',
      ${paid ? 100 : "NULL"},${paid || "NULL"},${paid ? "'pix'" : "NULL"},NULL,NULL,'${status}',1,1);`);
  db.exec(migration);
  return db;
}

function add(db, { id, type = "payment", amount, key = id, origin = "manual", reverse = null, external = null }) {
  return db.prepare(`INSERT OR IGNORE INTO payment_transactions
    (id,payment_id,type,amount_cents,payment_method,origin,occurred_at,created_by,
     external_transaction_id,reverses_transaction_id,idempotency_key,note,created_at)
    VALUES (?,'charge',?,?,'pix',?,200,'user',?,?,?,'audit',200) RETURNING id`)
    .get(id, type, amount, origin, external, reverse, key);
}

const charge = (db) => ({ ...db.prepare("SELECT paid_amount_cents,status,paid_at,payment_method FROM payments WHERE id='charge'").get() });
const net = (db) => db.prepare(`SELECT COALESCE(SUM(CASE WHEN type IN ('payment','opening_balance') THEN amount_cents ELSE -amount_cents END),0) value FROM payment_transactions WHERE payment_id='charge'`).get().value;

test("1-3 pagamento integral, parcial e dois pagamentos preservam ledger", () => {
  const full = database(); add(full,{id:"p1",amount:10000});
  assert.deepEqual(charge(full),{paid_amount_cents:10000,status:"paid",paid_at:200,payment_method:"pix"});
  const partial = database(); add(partial,{id:"p1",amount:4000}); add(partial,{id:"p2",amount:3000});
  assert.deepEqual(charge(partial),{paid_amount_cents:7000,status:"partial",paid_at:200,payment_method:"pix"});
  assert.equal(partial.prepare("SELECT count(*) n FROM payment_transactions WHERE type='payment'").get().n,2);
  assert.equal(net(partial),7000);
});

test("4 concorrência lógica 40+30 é serializada pelo trigger", async () => {
  const db=database();
  await Promise.all([Promise.resolve().then(()=>add(db,{id:"a",amount:4000})),Promise.resolve().then(()=>add(db,{id:"b",amount:3000}))]);
  assert.equal(charge(db).paid_amount_cents,7000); assert.equal(net(db),7000);
});

test("5 duas quitações simultâneas permitem somente uma", () => {
  const db=database(); add(db,{id:"a",amount:10000});
  assert.throws(()=>add(db,{id:"b",amount:10000}),/Pagamento inválido/);
  assert.equal(db.prepare("SELECT count(*) n FROM payment_transactions").get().n,1);
});

test("6-8 acima do saldo, cancelled e paid são bloqueados", () => {
  assert.throws(()=>add(database(),{id:"x",amount:10001}),/Pagamento inválido/);
  assert.throws(()=>add(database({status:"cancelled"}),{id:"x",amount:100}),/Pagamento inválido/);
  assert.throws(()=>add(database({paid:10000,status:"paid"}),{id:"x",amount:100}),/Pagamento inválido/);
});

test("9-11 webhook Asaas é idempotente inclusive concorrente", async () => {
  const db=database();
  const input={id:"asaas-1",amount:10000,key:"asaas:payment:pay_1:receipt",origin:"asaas",external:"pay_1"};
  const results=await Promise.all([Promise.resolve().then(()=>add(db,input)),Promise.resolve().then(()=>add(db,{...input,id:"asaas-2"}))]);
  assert.equal(results.filter(Boolean).length,1);
  assert.equal(charge(db).paid_amount_cents,10000); assert.equal(net(db),10000);
});

test("12 manual concorrendo com webhook nunca duplica saldo", async () => {
  const db=database();
  const outcomes=await Promise.allSettled([
    Promise.resolve().then(()=>add(db,{id:"manual",amount:10000})),
    Promise.resolve().then(()=>add(db,{id:"asaas",amount:10000,origin:"asaas",external:"pay",key:"asaas:payment:pay:receipt"})),
  ]);
  assert.equal(outcomes.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(charge(db).paid_amount_cents,10000); assert.equal(net(db),10000);
});

test("13 transaction e saldo são atualizados atomicamente", () => {
  const db=database(); add(db,{id:"p",amount:4000});
  assert.equal(db.prepare("SELECT count(*) n FROM payment_transactions").get().n,1);
  assert.equal(charge(db).paid_amount_cents,net(db));
});

test("14 falha ao criar transaction não altera mensalidade", () => {
  const db=database(); assert.throws(()=>add(db,{id:"bad",amount:20000}));
  assert.equal(charge(db).paid_amount_cents,null); assert.equal(db.prepare("SELECT count(*) n FROM payment_transactions").get().n,0);
});

test("15 falha ao atualizar mensalidade desfaz transaction", () => {
  const db=database(); db.exec("CREATE TRIGGER fail_payment_update BEFORE UPDATE ON payments BEGIN SELECT RAISE(ABORT,'falha simulada'); END;");
  assert.throws(()=>add(db,{id:"p",amount:1000}),/falha simulada/);
  assert.equal(db.prepare("SELECT count(*) n FROM payment_transactions").get().n,0); assert.equal(charge(db).paid_amount_cents,null);
});

test("16 estorno parcial preserva original e cria -30", () => {
  const db=database(); add(db,{id:"p",amount:10000}); add(db,{id:"r",type:"refund",amount:3000,reverse:"p"});
  assert.equal(charge(db).paid_amount_cents,7000); assert.equal(charge(db).status,"partial"); assert.equal(net(db),7000);
  assert.equal(db.prepare("SELECT count(*) n FROM payment_transactions").get().n,2);
});

test("17 estorno total reabre e mantém trilha", () => {
  const db=database(); add(db,{id:"p",amount:10000}); add(db,{id:"r",type:"refund",amount:10000,reverse:"p"});
  assert.equal(charge(db).paid_amount_cents,0); assert.equal(charge(db).status,"overdue"); assert.equal(net(db),0);
});

test("18 duplo estorno é bloqueado", () => {
  const db=database(); add(db,{id:"p",amount:10000}); add(db,{id:"r1",type:"refund",amount:10000,reverse:"p"});
  assert.throws(()=>add(db,{id:"r2",type:"refund",amount:1,reverse:"p"}),/Estorno inválido/);
});

test("19 opening balance é único, explícito e não altera legado", () => {
  const db=database({paid:5000,status:"partial"});
  assert.deepEqual({...db.prepare("SELECT type,origin,amount_cents FROM payment_transactions").get()},{type:"opening_balance",origin:"migration",amount_cents:5000});
  assert.equal(charge(db).paid_amount_cents,5000); assert.throws(()=>add(db,{id:"open",type:"opening_balance",amount:1}),/Opening balance/);
});

test("20 soma líquida sempre equivale ao materializado", () => {
  const db=database(); add(db,{id:"p1",amount:4000}); add(db,{id:"p2",amount:3000}); add(db,{id:"r",type:"refund",amount:1000,reverse:"p2"});
  assert.equal(net(db),6000); assert.equal(charge(db).paid_amount_cents,net(db));
});

test("21-22 inadimplência permanece após parcial e retorna após estorno", () => {
  const db=database(); add(db,{id:"p",amount:10000});
  assert.equal(db.prepare("SELECT financial_status s FROM athletes").get().s,"paid");
  add(db,{id:"r",type:"refund",amount:3000,reverse:"p"});
  assert.equal(db.prepare("SELECT financial_status s FROM athletes").get().s,"pending");
});

test("imutabilidade impede UPDATE e DELETE silenciosos", () => {
  const db=database(); add(db,{id:"p",amount:1000});
  assert.throws(()=>db.prepare("UPDATE payment_transactions SET amount_cents=1").run(),/imutáveis/);
  assert.throws(()=>db.prepare("DELETE FROM payment_transactions").run(),/imutáveis/);
});

test("writers manuais e webhook usam o serviço transacional", () => {
  const manual=readFileSync(new URL("../app/api/finance/charges/[id]/route.ts",import.meta.url),"utf8");
  const webhook=readFileSync(new URL("../app/api/webhooks/asaas/route.ts",import.meta.url),"utf8");
  assert.match(manual,/recordPaymentTransaction/); assert.doesNotMatch(manual,/SET paid_amount_cents/);
  assert.match(webhook,/recordPaymentTransaction/); assert.doesNotMatch(webhook,/paidAmountCents:\s*received/);
});
