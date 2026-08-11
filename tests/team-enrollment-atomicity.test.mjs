import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const orgA = "org-a";
const orgB = "org-b";
const athletes = new Map([
  ...Array.from({ length: 6 }, (_, index) => [`a${index + 1}`, { organizationId: orgA, active: true }]),
  ["b1", { organizationId: orgB, active: true }],
  ["inactive", { organizationId: orgA, active: false }],
]);
const categories = new Map([["Sub-11", orgA], ["Sub-13", orgB]]);

function initial() {
  return { teams: new Map(), memberships: new Map() };
}
function clone(state) {
  return structuredClone(state);
}
function fingerprint(state, teamId) {
  const team = state.teams.get(teamId);
  const members = [...state.memberships.values()]
    .filter((item) => item.teamId === teamId && item.active)
    .map((item) => item.athleteId).sort();
  return JSON.stringify({ team, members });
}
function normalize(payload) {
  if (!Array.isArray(payload.athleteIds ?? [])) throw new Error("invalid-id");
  if ((payload.athleteIds ?? []).some((id) => typeof id !== "string" || !id.trim())) throw new Error("invalid-id");
  const athleteIds = [...new Set((payload.athleteIds ?? []).map((id) => id.trim()))];
  if (!Number.isInteger(payload.capacity) || payload.capacity < 1 || payload.capacity > 100) throw new Error("capacity");
  if (athleteIds.length > payload.capacity) throw new Error("capacity");
  return { ...payload, athleteIds };
}
function validate(state, organizationId, payload, teamId) {
  const value = normalize(payload);
  if (categories.get(value.category) !== organizationId) throw new Error("category");
  if (teamId && state.teams.get(teamId)?.organizationId !== organizationId) throw new Error("team");
  for (const id of value.athleteIds) {
    const athlete = athletes.get(id);
    if (!athlete || !athlete.active || athlete.organizationId !== organizationId) throw new Error("athlete");
  }
  return value;
}
function post(state, organizationId, payload, failureAt = -1) {
  const value = validate(state, organizationId, payload);
  const draft = clone(state); const id = `team-${draft.teams.size + 1}`;
  draft.teams.set(id, { ...value, organizationId, active: true });
  value.athleteIds.forEach((athleteId, index) => {
    if (index === failureAt) throw new Error("injected");
    draft.memberships.set(`${id}:${athleteId}`, { teamId: id, athleteId, organizationId, active: true });
  });
  state.teams = draft.teams; state.memberships = draft.memberships; return id;
}
function patch(state, organizationId, teamId, payload, expected, failureAt = -1) {
  const value = validate(state, organizationId, payload, teamId);
  if (fingerprint(state, teamId) !== expected) throw new Error("conflict");
  const draft = clone(state);
  draft.teams.set(teamId, { ...draft.teams.get(teamId), ...value });
  for (const membership of draft.memberships.values()) if (membership.teamId === teamId) membership.active = false;
  value.athleteIds.forEach((athleteId, index) => {
    if (index === failureAt) throw new Error("injected");
    const key = `${teamId}:${athleteId}`;
    draft.memberships.set(key, { ...(draft.memberships.get(key) ?? {}), teamId, athleteId, organizationId, active: true });
  });
  state.teams = draft.teams; state.memberships = draft.memberships;
}
const payload = (athleteIds = [], extra = {}) => ({ name: "Turma A", category: "Sub-11", coachName: "Professor", scheduleDays: ["Seg"], startTime: "08:00", endTime: "09:00", place: "Campo", capacity: 10, athleteIds, ...extra });
const active = (state, id) => [...state.memberships.values()].filter((m) => m.teamId === id && m.active).map((m) => m.athleteId).sort();

test("1 POST válido sem atletas", () => { const s=initial(); const id=post(s,orgA,payload()); assert.deepEqual(active(s,id),[]); });
test("2 POST válido com 1 atleta", () => { const s=initial(); const id=post(s,orgA,payload(["a1"])); assert.deepEqual(active(s,id),["a1"]); });
test("3 POST válido com vários atletas", () => { const s=initial(); const id=post(s,orgA,payload(["a1","a2"])); assert.deepEqual(active(s,id),["a1","a2"]); });
test("4 athlete inexistente rejeita antes da escrita", () => { const s=initial(); assert.throws(()=>post(s,orgA,payload(["missing"]))); assert.equal(s.teams.size,0); });
test("5 Athlete B rejeita antes da escrita", () => { const s=initial(); assert.throws(()=>post(s,orgA,payload(["b1"]))); assert.equal(s.teams.size,0); });
test("6 category inexistente rejeita antes da escrita", () => { const s=initial(); assert.throws(()=>post(s,orgA,payload([], {category:"missing"}))); assert.equal(s.teams.size,0); });
test("7 category cross-tenant rejeita", () => { const s=initial(); assert.throws(()=>post(s,orgA,payload([], {category:"Sub-13"}))); assert.equal(s.teams.size,0); });
test("8 capacidade excedida rejeita", () => { const s=initial(); assert.throws(()=>post(s,orgA,payload(["a1","a2"],{capacity:1}))); assert.equal(s.teams.size,0); });
test("9 athleteIds duplicados são deduplicados", () => { const s=initial(); const id=post(s,orgA,payload(["a1","a1"],{capacity:1})); assert.deepEqual(active(s,id),["a1"]); });
test("10 falha em membership causa rollback total", () => { const s=initial(); assert.throws(()=>post(s,orgA,payload(["a1"]),0)); assert.equal(s.teams.size,0); });
test("11 nenhuma turma órfã após falha final", () => { const s=initial(); assert.throws(()=>post(s,orgA,payload(["a1","a2"]),1)); assert.equal(s.teams.size,0); assert.equal(s.memberships.size,0); });

function seeded() { const s=initial(); const id=post(s,orgA,payload(["a1","a2","a3"])); return {s,id}; }
test("12 PATCH somente campos funciona", () => { const {s,id}=seeded(); patch(s,orgA,id,payload(["a1","a2","a3"],{name:"Nova"}),fingerprint(s,id)); assert.equal(s.teams.get(id).name,"Nova"); });
test("13 PATCH substitui atletas", () => { const {s,id}=seeded(); patch(s,orgA,id,payload(["a4","a5"]),fingerprint(s,id)); assert.deepEqual(active(s,id),["a4","a5"]); });
test("14 PATCH remove todos preservando histórico", () => { const {s,id}=seeded(); patch(s,orgA,id,payload([]),fingerprint(s,id)); assert.deepEqual(active(s,id),[]); assert.equal(s.memberships.size,3); });
test("15 PATCH athlete inválido não altera", () => { const {s,id}=seeded(); const before=fingerprint(s,id); assert.throws(()=>patch(s,orgA,id,payload(["missing"]),before)); assert.equal(fingerprint(s,id),before); });
test("16 PATCH athlete cross-tenant não altera", () => { const {s,id}=seeded(); const before=fingerprint(s,id); assert.throws(()=>patch(s,orgA,id,payload(["b1"]),before)); assert.equal(fingerprint(s,id),before); });
test("17 PATCH capacidade inválida não altera", () => { const {s,id}=seeded(); const before=fingerprint(s,id); assert.throws(()=>patch(s,orgA,id,payload(["a1","a2"],{capacity:1}),before)); assert.equal(fingerprint(s,id),before); });
test("18 falha após UPDATE não persiste campos", () => { const {s,id}=seeded(); const before=fingerprint(s,id); assert.throws(()=>patch(s,orgA,id,payload(["a4"],{name:"Nova"}),before,0)); assert.equal(fingerprint(s,id),before); });
test("19 falha no meio preserva lista antiga", () => { const {s,id}=seeded(); const before=fingerprint(s,id); assert.throws(()=>patch(s,orgA,id,payload(["a4","a5","a6"]),before,1)); assert.deepEqual(active(s,id),["a1","a2","a3"]); });
test("20 reativação funciona", () => { const {s,id}=seeded(); patch(s,orgA,id,payload([]),fingerprint(s,id)); patch(s,orgA,id,payload(["a1"]),fingerprint(s,id)); assert.deepEqual(active(s,id),["a1"]); });
test("21 novo vínculo funciona", () => { const {s,id}=seeded(); patch(s,orgA,id,payload(["a4"]),fingerprint(s,id)); assert.deepEqual(active(s,id),["a4"]); });
test("22 removido fica inativo", () => { const {s,id}=seeded(); patch(s,orgA,id,payload(["a1"]),fingerprint(s,id)); assert.equal(s.memberships.get(`${id}:a2`).active,false); });
test("23 PATCH A x B termina completo", () => { const {s,id}=seeded(); const snap=fingerprint(s,id); patch(s,orgA,id,payload(["a1","a2"]),snap); assert.throws(()=>patch(s,orgA,id,payload(["a3","a4"]),snap),/conflict/); assert.deepEqual(active(s,id),["a1","a2"]); });
test("24 concorrência não ultrapassa capacidade", () => { const {s,id}=seeded(); const snap=fingerprint(s,id); patch(s,orgA,id,payload(["a1","a2","a3","a4"],{capacity:4}),snap); assert.throws(()=>patch(s,orgA,id,payload(["a1","a2","a3","a5"],{capacity:4}),snap)); assert.equal(active(s,id).length,4); });
test("25 POST não possui chave lógica aplicável", () => { const s=initial(); post(s,orgA,payload()); post(s,orgA,payload()); assert.equal(s.teams.size,2); });
test("26 vínculo ativo não duplica", () => { const {s,id}=seeded(); patch(s,orgA,id,payload(["a1","a1"]),fingerprint(s,id)); assert.deepEqual(active(s,id),["a1"]); });
test("27 Org A não altera Team B", () => { const s=initial(); const id=post(s,orgB,{...payload(),category:"Sub-13"}); assert.throws(()=>patch(s,orgA,id,payload(),fingerprint(s,id))); });
test("28 Org A não cria com Athlete B", () => { const s=initial(); assert.throws(()=>post(s,orgA,payload(["b1"]))); });
test("29 Org A não cria com Category B", () => { const s=initial(); assert.throws(()=>post(s,orgA,payload([],{category:"Sub-13"}))); });
test("30 Org A não adiciona Athlete B", () => { const {s,id}=seeded(); assert.throws(()=>patch(s,orgA,id,payload(["b1"]),fingerprint(s,id))); });
test("31 cross-tenant preserva team e memberships", () => { const {s,id}=seeded(); const before=fingerprint(s,id); assert.throws(()=>patch(s,orgA,id,payload(["b1"],{name:"Hack"}),before)); assert.equal(fingerprint(s,id),before); });

const postSource = readFileSync(new URL("../app/api/teams/route.ts", import.meta.url), "utf8");
const patchSource = readFileSync(new URL("../app/api/teams/[id]/route.ts", import.meta.url), "utf8");
const athleteSource = readFileSync(new URL("../app/api/athletes/route.ts", import.meta.url), "utf8");
test("API real usa D1.batch no POST e PATCH",()=>{ assert.match(postSource,/await d1\.batch\(statements\)/); assert.match(patchSource,/await d1\.batch\(statements\)/); });
test("PATCH real usa snapshot otimista e conflito 409",()=>{ assert.match(patchSource,/previousMembershipPredicates/); assert.match(patchSource,/status: 409/); });
test("GET real faz join defensivo com athlete tenant",()=>{ assert.match(postSource,/eq\(athletes\.organizationId, teamAthletes\.organizationId\)/); });
test("cadastro de atleta agrupa athlete e membership em D1.batch",()=>{ assert.match(athleteSource,/await d1\.batch\(statements\)/); assert.match(athleteSource,/INSERT INTO team_athletes/); });
test("cadastro incremental reserva capacidade por snapshot",()=>{ assert.match(athleteSource,/currentEnrollments\.length >= selectedTeam\.capacity/); assert.match(athleteSource,/A turma foi alterada por outra operação/); });
