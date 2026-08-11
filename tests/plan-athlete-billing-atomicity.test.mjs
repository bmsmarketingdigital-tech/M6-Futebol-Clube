import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const A="org-a", B="org-b";
function state(){return {plans:new Map(),athletes:new Map(),billing:new Map(),payments:1,ledger:1};}
function clone(s){return structuredClone(s);}
function plan(s,id="pA",org=A,active=true){s.plans.set(id,{id,org,active});return id;}
function athlete(s,id="aA",org=A){s.athletes.set(id,{id,org,active:true});return id;}
function assign(s,org,athleteId,planId,active=true){const a=s.athletes.get(athleteId),p=s.plans.get(planId);if(!a||!p||a.org!==org||p.org!==org||!p.active)throw Error("invalid");s.billing.set(athleteId,{athleteId,planId,org,active});}
function archive(s,org,id,fail=false){const p=s.plans.get(id);if(!p||p.org!==org)return false;const d=clone(s);d.plans.get(id).active=false;for(const b of d.billing.values())if(b.org===org&&b.planId===id){if(fail)throw Error("injected");b.active=false;}s.plans=d.plans;s.billing=d.billing;return true;}
function restore(s,org,id){const p=s.plans.get(id);if(!p||p.org!==org||p.active)return false;p.active=true;return true;}
function snap(s,id){return JSON.stringify({p:s.plans.get(id),b:[...s.billing.values()].filter(x=>x.planId===id)});}

test("1 archive sem configurações",()=>{const s=state();plan(s);assert.equal(archive(s,A,"pA"),true);assert.equal(s.plans.get("pA").active,false);});
test("2 archive com uma configuração",()=>{const s=state();plan(s);athlete(s);assign(s,A,"aA","pA");archive(s,A,"pA");assert.equal(s.billing.get("aA").active,false);});
test("3 archive com várias configurações",()=>{const s=state();plan(s);for(const id of ["a1","a2","a3"]){athlete(s,id);assign(s,A,id,"pA");}archive(s,A,"pA");assert.ok([...s.billing.values()].every(x=>!x.active));});
test("4 plano inexistente é rejeitado",()=>{const s=state();assert.equal(archive(s,A,"missing"),false);});
test("5 plano de Org B é rejeitado",()=>{const s=state();plan(s,"pB",B);assert.equal(archive(s,A,"pB"),false);assert.equal(s.plans.get("pB").active,true);});
test("6 falha em configuração faz rollback do plano",()=>{const s=state();plan(s);athlete(s);assign(s,A,"aA","pA");const before=snap(s,"pA");assert.throws(()=>archive(s,A,"pA",true));assert.equal(snap(s,"pA"),before);});
test("7 config de outro tenant permanece intacta",()=>{const s=state();plan(s);plan(s,"pB",B);athlete(s);athlete(s,"aB",B);assign(s,A,"aA","pA");assign(s,B,"aB","pB");archive(s,A,"pA");assert.equal(s.billing.get("aB").active,true);});
test("8 histórico de payments não muda",()=>{const s=state();plan(s);const before=s.payments;archive(s,A,"pA");assert.equal(s.payments,before);});
test("9 ledger não muda",()=>{const s=state();plan(s);const before=s.ledger;archive(s,A,"pA");assert.equal(s.ledger,before);});
test("10 restore válido restaura somente o plano",()=>{const s=state();plan(s);athlete(s);assign(s,A,"aA","pA");archive(s,A,"pA");assert.equal(restore(s,A,"pA"),true);assert.equal(s.plans.get("pA").active,true);assert.equal(s.billing.get("aA").active,false);});
test("11 restore cross-tenant bloqueado",()=>{const s=state();plan(s,"pB",B,false);assert.equal(restore(s,A,"pB"),false);});
test("12 restore preserva estado se alvo inválido",()=>{const s=state();plan(s);const before=snap(s,"pA");assert.equal(restore(s,A,"missing"),false);assert.equal(snap(s,"pA"),before);});
test("13 regra de restore não reativa athlete_billing",()=>{const s=state();plan(s);athlete(s);assign(s,A,"aA","pA");archive(s,A,"pA");restore(s,A,"pA");assert.equal(s.billing.get("aA").active,false);});
test("14 restore não altera histórico financeiro",()=>{const s=state();plan(s,false);const p=s.payments,l=s.ledger;restore(s,A,"pA");assert.equal(s.payments,p);assert.equal(s.ledger,l);});
test("15 não atribui plano inativo",()=>{const s=state();plan(s,"pA",A,false);athlete(s);assert.throws(()=>assign(s,A,"aA","pA"));});
test("16 não atribui Plan B a Athlete A",()=>{const s=state();plan(s,"pB",B);athlete(s);assert.throws(()=>assign(s,A,"aA","pB"));});
test("17 athlete_billing mantém tenant consistente",()=>{const s=state();plan(s);athlete(s);assign(s,A,"aA","pA");assert.equal(s.billing.get("aA").org,A);});
test("18 ativação exige plano ativo",()=>{const s=state();plan(s,"pA",A,false);athlete(s);assert.throws(()=>assign(s,A,"aA","pA",true));});
test("19 archive x restore termina coerente",()=>{const s=state();plan(s);athlete(s);assign(s,A,"aA","pA");archive(s,A,"pA");restore(s,A,"pA");assert.equal(s.plans.get("pA").active,true);assert.equal(s.billing.get("aA").active,false);});
test("20 archive x assignment não cria config ativa em plano inativo",()=>{const s=state();plan(s);athlete(s);archive(s,A,"pA");assert.throws(()=>assign(s,A,"aA","pA"));});
test("21 archives simultâneos são idempotentes",()=>{const s=state();plan(s);archive(s,A,"pA");assert.equal(archive(s,A,"pA"),true);assert.equal(s.plans.get("pA").active,false);});
test("22 restores simultâneos são coerentes",()=>{const s=state();plan(s,"pA",A,false);restore(s,A,"pA");assert.equal(restore(s,A,"pA"),false);assert.equal(s.plans.get("pA").active,true);});

const archiveSource=readFileSync(new URL("../app/api/finance/plans/[id]/route.ts",import.meta.url),"utf8");
const assignmentSource=readFileSync(new URL("../app/api/finance/athletes/[athleteId]/route.ts",import.meta.url),"utf8");
const generationSource=readFileSync(new URL("../app/api/finance/billing-automation.ts",import.meta.url),"utf8");
test("API archive usa batch tenant-scoped",()=>{assert.match(archiveSource,/await d1\.batch/);assert.match(archiveSource,/organization_id = \?/g);});
test("assignment real exige athlete e plan ativos no mesmo tenant",()=>{assert.match(assignmentSource,/p\.active = 1/);assert.match(assignmentSource,/p\.organization_id = a\.organization_id/);assert.match(assignmentSource,/await getD1\(\)\.batch/);});
test("geração mensal filtra configurações e planos ativos",()=>{assert.match(generationSource,/billingPlans\.active/);assert.match(generationSource,/athleteBilling\.active/);});
test("restore real não reativa athlete_billing automaticamente",()=>{const source=readFileSync(new URL("../app/api/finance/plans/[id]/restore/route.ts",import.meta.url),"utf8");assert.doesNotMatch(source,/athleteBilling/);});
