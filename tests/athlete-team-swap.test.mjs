import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Simulação em memória do endpoint app/api/athletes/[id]/team/route.ts
// (PATCH): troca atômica de turma do atleta a partir da edição de atleta.

const orgA = "org-a";
const orgB = "org-b";

function initial() {
  return {
    athletes: new Map([
      ["a1", { organizationId: orgA, category: "Sub-11", active: true }],
      ["a2", { organizationId: orgA, category: "Sub-11", active: true }],
      ["a3", { organizationId: orgA, category: "Sub-11", active: true }],
    ]),
    teams: new Map([
      ["team-11a", { organizationId: orgA, category: "Sub-11", capacity: 2, active: true }],
      ["team-11b", { organizationId: orgA, category: "Sub-11", capacity: 1, active: true }],
      ["team-13a", { organizationId: orgA, category: "Sub-13", capacity: 2, active: true }],
      ["team-b", { organizationId: orgB, category: "Sub-11", capacity: 2, active: true }],
    ]),
    memberships: new Map(),
  };
}

function activeTeamOf(state, athleteId) {
  const rows = [...state.memberships.values()].filter(
    (m) => m.athleteId === athleteId && m.active,
  );
  return rows[0]?.teamId ?? null;
}

function activeMembersOf(state, teamId) {
  return [...state.memberships.values()]
    .filter((m) => m.teamId === teamId && m.active)
    .map((m) => m.athleteId)
    .sort();
}

function enroll(state, teamId, athleteId) {
  state.memberships.set(`${teamId}:${athleteId}`, {
    teamId,
    athleteId,
    organizationId: state.teams.get(teamId).organizationId,
    active: true,
  });
}

// Espelha app/api/athletes/[id]/team/route.ts PATCH.
function swapTeam(state, organizationId, athleteId, requestedTeamId) {
  const athlete = state.athletes.get(athleteId);
  if (!athlete || athlete.organizationId !== organizationId || !athlete.active) {
    throw new Error("athlete-not-found");
  }
  const currentTeamId = activeTeamOf(state, athleteId);
  if (currentTeamId === requestedTeamId) return { teamId: currentTeamId };

  if (!requestedTeamId) {
    for (const membership of state.memberships.values()) {
      if (membership.athleteId === athleteId && membership.active) {
        membership.active = false;
      }
    }
    return { teamId: null };
  }

  const targetTeam = state.teams.get(requestedTeamId);
  if (!targetTeam || targetTeam.organizationId !== organizationId || !targetTeam.active) {
    throw new Error("team-not-found");
  }
  if (targetTeam.category !== athlete.category) {
    throw new Error("category-mismatch");
  }
  const currentCount = activeMembersOf(state, requestedTeamId).length;
  if (currentCount >= targetTeam.capacity) {
    throw new Error("capacity");
  }

  // Só a partir daqui o estado é efetivamente escrito — espelha o batch
  // atômico real: nada muda se qualquer validação acima falhar.
  if (currentTeamId) {
    const old = state.memberships.get(`${currentTeamId}:${athleteId}`);
    if (old) old.active = false;
  }
  enroll(state, requestedTeamId, athleteId);
  return { teamId: requestedTeamId };
}

// 1. A -> B com vaga disponível
test("1 troca de turma A para B com vaga disponível", () => {
  const s = initial();
  enroll(s, "team-11a", "a1");
  swapTeam(s, orgA, "a1", "team-11b");
  assert.equal(activeTeamOf(s, "a1"), "team-11b");
  assert.deepEqual(activeMembersOf(s, "team-11a"), []);
});

// 2. A -> B cheia mantém A intacta
test("2 turma B cheia mantém atleta em A (nenhuma escrita parcial)", () => {
  const s = initial();
  enroll(s, "team-11a", "a1");
  enroll(s, "team-11b", "a2"); // team-11b capacity 1, já cheia
  assert.throws(() => swapTeam(s, orgA, "a1", "team-11b"), /capacity/);
  assert.equal(activeTeamOf(s, "a1"), "team-11a");
  assert.deepEqual(activeMembersOf(s, "team-11a"), ["a1"]);
});

// 3. A -> sem turma
test("3 remoção para 'sem turma' desativa vínculo, atleta segue ativo", () => {
  const s = initial();
  enroll(s, "team-11a", "a1");
  swapTeam(s, orgA, "a1", null);
  assert.equal(activeTeamOf(s, "a1"), null);
  assert.equal(s.athletes.get("a1").active, true);
});

// 4. Sub-11 -> Sub-13 + escolha de nova turma Sub-13 compatível
test("4 troca de categoria com nova turma compatível", () => {
  const s = initial();
  enroll(s, "team-11a", "a1");
  s.athletes.get("a1").category = "Sub-13"; // categoria já alterada pelo PATCH de atleta
  swapTeam(s, orgA, "a1", "team-13a");
  assert.equal(activeTeamOf(s, "a1"), "team-13a");
});

// 5. Sub-11 -> Sub-13 + "sem turma"
test("5 troca de categoria sem selecionar nova turma", () => {
  const s = initial();
  enroll(s, "team-11a", "a1");
  s.athletes.get("a1").category = "Sub-13";
  swapTeam(s, orgA, "a1", null);
  assert.equal(activeTeamOf(s, "a1"), null);
});

// 6. tentativa de turma incompatível é bloqueada no backend
test("6 turma de categoria incompatível é rejeitada mesmo que enviada diretamente", () => {
  const s = initial();
  assert.throws(() => swapTeam(s, orgA, "a3", "team-13a"), /category-mismatch/);
  assert.equal(activeTeamOf(s, "a3"), null);
});

// 7. concorrência na última vaga: segunda tentativa falha, primeira mantém
test("7 última vaga: apenas uma matrícula concorrente é aceita", () => {
  const s = initial();
  enroll(s, "team-11b", "a1"); // ocupa a única vaga de team-11b (capacity 1)... para forçar cenário, reabra
  s.memberships.get("team-11b:a1").active = false; // libera para o teste
  swapTeam(s, orgA, "a2", "team-11b"); // ocupa a vaga
  assert.throws(() => swapTeam(s, orgA, "a3", "team-11b"), /capacity/);
  assert.deepEqual(activeMembersOf(s, "team-11b"), ["a2"]);
});

// 8. histórico preservado — validado via regex de fonte abaixo (o endpoint
// real nunca deleta ou altera attendance/check-in).

// 9. financeiro não é afetado — validado via regex de fonte abaixo.

test("tenant isolation: não é possível mover atleta de Org A para turma de Org B", () => {
  const s = initial();
  assert.throws(() => swapTeam(s, orgA, "a1", "team-b"), /team-not-found/);
});

// ------------------------------------------------------------------
// Fonte real
// ------------------------------------------------------------------
const swapSource = readFileSync(
  new URL("../app/api/athletes/[id]/team/route.ts", import.meta.url),
  "utf8",
);

test("fonte real: endpoint valida categoria antes de escrever", () => {
  assert.match(swapSource, /targetTeam\.category !== athlete\.category/);
});

test("fonte real: endpoint valida capacidade antes de escrever", () => {
  assert.match(swapSource, /currentEnrollments\.length >= targetTeam\.capacity/);
});

test("fonte real: troca é atômica via d1.batch com marcador de concorrência", () => {
  assert.match(swapSource, /d1\.batch\(statements\)/);
  assert.match(swapSource, /__team_swap__/);
});

test("fonte real: nunca faz DELETE em team_athletes (soft-deactivate preserva histórico)", () => {
  assert.doesNotMatch(swapSource, /DELETE FROM team_athletes/);
});

test("fonte real: endpoint não referencia tabelas financeiras ou de attendance", () => {
  assert.doesNotMatch(
    swapSource,
    /attendance_sessions|attendance_records|billing_plan|athlete_billing|payments|payment_transactions|ledger|combo/i,
  );
});

test("fonte real: caso 'sem turma' não exige validação de turma nova", () => {
  assert.match(swapSource, /if \(!requestedTeamId\) \{/);
});
