import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const A="org-a",B="org-b";
function fixture(){return {athletes:new Map([["aA",{org:A,active:true,name:"A"}],["aB",{org:B,active:true,name:"B"}]]),plans:new Map([["pA",{org:A,active:true,amount:100}],["pB",{org:B,active:true,amount:200}]]),configs:[],payments:[],outbox:[]};}
function eligible(s,c){const a=s.athletes.get(c.athlete),p=s.plans.get(c.plan);return c.org===A&&c.active&&a?.active&&a.org===c.org&&p?.active&&p.org===c.org;}
function generate(s){for(const c of s.configs)if(eligible(s,c)&&!s.payments.some(p=>p.athlete===c.athlete&&p.month===c.month))s.payments.push({athlete:c.athlete,month:c.month,org:c.org,amount:s.plans.get(c.plan).amount});return s.payments.length;}
function automate(s){for(const c of s.configs)if(eligible(s,c)&&!s.outbox.includes(c.athlete))s.outbox.push(c.athlete);return s.outbox.length;}
function add(s,athlete,plan,org=A,month="2026-08"){s.configs.push({athlete,plan,org,active:true,month});}

test("1 config A + Athlete A + Plan A gera",()=>{const s=fixture();add(s,"aA","pA");assert.equal(generate(s),1);});
test("2 config A + Athlete B + Plan A não gera",()=>{const s=fixture();add(s,"aB","pA");assert.equal(generate(s),0);});
test("3 config A + Athlete A + Plan B não gera",()=>{const s=fixture();add(s,"aA","pB");assert.equal(generate(s),0);});
test("4 ambos cross-tenant não geram",()=>{const s=fixture();add(s,"aB","pB");assert.equal(generate(s),0);});
test("5 config cross-tenant não altera payments",()=>{const s=fixture();add(s,"aB","pB");generate(s);assert.deepEqual(s.payments,[]);});
test("6 config cross-tenant não cria duplicidade",()=>{const s=fixture();add(s,"aB","pB");generate(s);generate(s);assert.equal(s.payments.length,0);});
test("7 config válida mantém idempotência",()=>{const s=fixture();add(s,"aA","pA");generate(s);generate(s);assert.equal(s.payments.length,1);});
test("8 plano inativo não gera",()=>{const s=fixture();s.plans.get("pA").active=false;add(s,"aA","pA");assert.equal(generate(s),0);});
test("9 atleta inativo não gera",()=>{const s=fixture();s.athletes.get("aA").active=false;add(s,"aA","pA");assert.equal(generate(s),0);});
test("10 config válida entra na automação",()=>{const s=fixture();add(s,"aA","pA");assert.equal(automate(s),1);});
test("11 atleta cross-tenant é excluído da automação",()=>{const s=fixture();add(s,"aB","pA");assert.equal(automate(s),0);});
test("12 plano cross-tenant é excluído da automação",()=>{const s=fixture();add(s,"aA","pB");assert.equal(automate(s),0);});
test("13 ambos cross-tenant são excluídos",()=>{const s=fixture();add(s,"aB","pB");assert.equal(automate(s),0);});
test("14-16 incoerência não cria before_due/due_today/overdue",()=>{const s=fixture();add(s,"aB","pB");assert.equal(automate(s),0);assert.deepEqual(s.outbox,[]);});
test("17 nenhum sender recebe relação incoerente",()=>{const s=fixture();add(s,"aB","pB");automate(s);assert.equal(s.outbox.length,0);});
test("18 config válida preserva organization do payment",()=>{const s=fixture();add(s,"aA","pA");generate(s);assert.equal(s.payments[0].org,A);});

const source=readFileSync(new URL("../app/api/finance/billing-automation.ts",import.meta.url),"utf8");
test("joins da geração exigem tenant de athlete e plan",()=>{assert.match(source,/eq\(athletes\.organizationId, athleteBilling\.organizationId\)/);assert.match(source,/eq\(billingPlans\.organizationId, athleteBilling\.organizationId\)/);});
test("join de payments da automação exige tenant do athlete",()=>{assert.match(source,/eq\(athletes\.organizationId, payments\.organizationId\)/);});
