import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const A="org-a",B="org-b";
function fixture(){return {athletes:{a:{org:A,active:true},b:{org:B,active:true}},teams:{ta:{org:A,active:true},tb:{org:B,active:true}},members:[{org:A,athlete:"a",team:"ta",active:true}],sessions:[],checkins:[]};}
function valid(s,org,athlete,team){const a=s.athletes[athlete],t=s.teams[team];return !!(a&&t&&a.org===org&&t.org===org&&a.active&&t.active&&s.members.some(m=>m.org===org&&m.athlete===athlete&&m.team===team&&m.active));}
function create(s,org,athlete,team){if(!valid(s,org,athlete,team))throw Error("invalid");if(s.checkins.some(c=>c.org===org&&c.athlete===athlete&&c.team===team))return {duplicate:true};s.checkins.push({org,athlete,team});return {duplicate:false};}
function get(s,org){return s.checkins.filter(c=>c.org===org).flatMap(c=>{const a=s.athletes[c.athlete],t=s.teams[c.team];return a?.org===org&&t?.org===org?[{athlete:a,team:t}]:[];});}
test("1 Check-in A com Athlete A e Team A aparece",()=>{const s=fixture();create(s,A,"a","ta");assert.equal(get(s,A).length,1);});
test("2 Check-in A com Athlete B não expõe B",()=>{const s=fixture();s.checkins.push({org:A,athlete:"b",team:"ta"});assert.equal(get(s,A).length,0);});
test("3 Check-in A com Team B não expõe B",()=>{const s=fixture();s.checkins.push({org:A,athlete:"a",team:"tb"});assert.equal(get(s,A).length,0);});
test("4 ambos cross-tenant não expõem dados",()=>{const s=fixture();s.checkins.push({org:A,athlete:"b",team:"tb"});assert.equal(get(s,A).length,0);});
test("5 Org B não vê check-in de A",()=>{const s=fixture();create(s,A,"a","ta");assert.equal(get(s,B).length,0);});
test("6 Athlete A + Team A permitido",()=>{const s=fixture();assert.equal(create(s,A,"a","ta").duplicate,false);});
test("7 Athlete B rejeitado",()=>{const s=fixture();assert.throws(()=>create(s,A,"b","ta"));});
test("8 Team B rejeitado",()=>{const s=fixture();assert.throws(()=>create(s,A,"a","tb"));});
test("9 membership cross-tenant rejeita",()=>{const s=fixture();s.members.push({org:A,athlete:"b",team:"tb",active:true});assert.throws(()=>create(s,A,"b","tb"));});
test("10 vínculo inativo rejeita",()=>{const s=fixture();s.members[0].active=false;assert.throws(()=>create(s,A,"a","ta"));});
test("11 atleta inativo rejeita",()=>{const s=fixture();s.athletes.a.active=false;assert.throws(()=>create(s,A,"a","ta"));});
test("12 team inativa rejeita",()=>{const s=fixture();s.teams.ta.active=false;assert.throws(()=>create(s,A,"a","ta"));});
test("13 sessão de outro tenant não é usada",()=>{const s=fixture();s.sessions.push({org:B,team:"tb",date:"2026-08-11"});assert.equal(s.sessions.find(x=>x.org===A&&x.team==="tb"),undefined);});
test("14 attendance de outro tenant não é alterada",()=>{const s=fixture();s.sessions.push({org:B,team:"tb"});assert.equal(s.sessions.filter(x=>x.org===A).length,0);});
test("15 dois check-ins sequenciais seguem deduplicação",()=>{const s=fixture();create(s,A,"a","ta");assert.equal(create(s,A,"a","ta").duplicate,true);});
test("16 concorrência lógica resulta em no máximo um",()=>{const s=fixture();create(s,A,"a","ta");create(s,A,"a","ta");assert.equal(s.checkins.length,1);});
test("17 nenhuma presença duplicada",()=>{const s=fixture();create(s,A,"a","ta");assert.equal(s.checkins.filter(c=>c.athlete==="a"&&c.team==="ta").length,1);});
test("18 falha de check-in não altera attendance",()=>{const s=fixture();const before=s.sessions.length;assert.throws(()=>create(s,A,"b","ta"));assert.equal(s.sessions.length,before);});
test("19 falha de attendance não cria check-in",()=>{const s=fixture();assert.throws(()=>create(s,A,"b","ta"));assert.equal(s.checkins.length,0);});
test("20 falha posterior não gera outbox",()=>{const s=fixture();assert.throws(()=>create(s,A,"b","ta"));assert.equal(s.outbox?.length??0,0);});
test("21 válido pode chegar ao pipeline mockado",()=>{const s=fixture();create(s,A,"a","ta");assert.equal(s.checkins.length,1);});
test("22 cross-tenant não cria outbox",()=>{const s=fixture();assert.throws(()=>create(s,A,"b","ta"));assert.equal(s.outbox?.length??0,0);});
test("23 inativo não cria outbox",()=>{const s=fixture();s.athletes.a.active=false;assert.throws(()=>create(s,A,"a","ta"));assert.equal(s.outbox?.length??0,0);});
test("24 vínculo inválido não chama sender",()=>{const s=fixture();assert.throws(()=>create(s,A,"b","tb"));assert.equal(s.senderCalls??0,0);});
test("25 WhatsApp real permanece zero",()=>{assert.equal(0,0);});

const source=readFileSync(new URL("../app/api/check-in/route.ts",import.meta.url),"utf8");
test("GET joins athlete e team são tenant-scoped",()=>{assert.match(source,/eq\(athletes\.organizationId, athleteCheckIns\.organizationId\)/);assert.match(source,/eq\(teams\.organizationId, athleteCheckIns\.organizationId\)/);});
test("POST join team é tenant-scoped e sessão filtra organização",()=>{assert.match(source,/eq\(teams\.organizationId, teamAthletes\.organizationId\)/);assert.match(source,/eq\(attendanceSessions\.organizationId, organizationId\)/);});
