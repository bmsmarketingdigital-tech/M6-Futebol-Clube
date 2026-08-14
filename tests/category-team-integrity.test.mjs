import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Simulação em memória da lógica real de:
//  - app/api/athletes/[id]/route.ts (PATCH: troca de category)
//  - app/api/teams/[id]/route.ts    (PATCH: troca de roster)
// Espelha as regras efetivamente implementadas (categoria compatível,
// tenant isolation, capacidade, soft-deactivate preservando histórico).

const orgA = "org-a";
const orgB = "org-b";

function initial() {
  return {
    athletes: new Map([
      ["a1", { organizationId: orgA, category: "Sub-11", active: true }],
      ["a2", { organizationId: orgA, category: "Sub-11", active: true }],
      ["a3", { organizationId: orgA, category: "Sub-11", active: true }],
      ["a4", { organizationId: orgA, category: "Sub-13", active: true }],
      ["b1", { organizationId: orgB, category: "Sub-11", active: true }],
    ]),
    teams: new Map([
      ["team-11a", { organizationId: orgA, category: "Sub-11", capacity: 2, active: true }],
      ["team-11b", { organizationId: orgA, category: "Sub-11", capacity: 2, active: true }],
      ["team-13a", { organizationId: orgA, category: "Sub-13", capacity: 2, active: true }],
      ["team-b", { organizationId: orgB, category: "Sub-11", capacity: 2, active: true }],
    ]),
    memberships: new Map(),
  };
}

function clone(state) {
  return structuredClone(state);
}

function activeMembersOf(state, teamId) {
  return [...state.memberships.values()]
    .filter((m) => m.teamId === teamId && m.active)
    .map((m) => m.athleteId)
    .sort();
}

function activeTeamOf(state, athleteId) {
  const rows = [...state.memberships.values()].filter(
    (m) => m.athleteId === athleteId && m.active,
  );
  return rows[0]?.teamId ?? null;
}

// Espelha app/api/teams/[id]/route.ts PATCH: substitui o roster inteiro
// validando tenant, categoria e capacidade — e só então escreve (atômico).
function patchTeamRoster(state, organizationId, teamId, athleteIds) {
  const team = state.teams.get(teamId);
  if (!team || team.organizationId !== organizationId || !team.active) {
    throw new Error("team-not-found");
  }
  const uniqueIds = [...new Set(athleteIds)];
  if (uniqueIds.length > team.capacity) throw new Error("capacity");
  for (const id of uniqueIds) {
    const athlete = state.athletes.get(id);
    if (!athlete || !athlete.active || athlete.organizationId !== organizationId) {
      throw new Error("athlete-invalid");
    }
    if (athlete.category !== team.category) throw new Error("category-mismatch");
  }
  const draft = clone(state);
  for (const membership of draft.memberships.values()) {
    if (membership.teamId === teamId) membership.active = false;
  }
  for (const athleteId of uniqueIds) {
    const key = `${teamId}:${athleteId}`;
    draft.memberships.set(key, {
      ...(draft.memberships.get(key) ?? {}),
      teamId,
      athleteId,
      organizationId,
      active: true,
    });
  }
  state.teams = draft.teams;
  state.memberships = draft.memberships;
}

// Espelha app/api/athletes/[id]/route.ts PATCH: atualiza a categoria e,
// se ela mudou, desativa (soft) memberships em turmas incompatíveis.
function patchAthleteCategory(state, organizationId, athleteId, newCategory) {
  const athlete = state.athletes.get(athleteId);
  if (!athlete || athlete.organizationId !== organizationId || !athlete.active) {
    throw new Error("athlete-not-found");
  }
  const categoryChanged = athlete.category !== newCategory;
  const draft = clone(state);
  draft.athletes.get(athleteId).category = newCategory;
  if (categoryChanged) {
    for (const membership of draft.memberships.values()) {
      if (membership.athleteId !== athleteId || !membership.active) continue;
      const team = draft.teams.get(membership.teamId);
      if (team && team.category !== newCategory) membership.active = false;
    }
  }
  state.athletes = draft.athletes;
  state.memberships = draft.memberships;
}

function seededWithA1InTeam11a() {
  const s = initial();
  patchTeamRoster(s, orgA, "team-11a", ["a1", "a2"]);
  return s;
}

// 1. atleta Sub-11 + turma Sub-11 -> permitido
test("1 atleta Sub-11 entra em turma Sub-11", () => {
  const s = initial();
  patchTeamRoster(s, orgA, "team-11a", ["a1"]);
  assert.deepEqual(activeMembersOf(s, "team-11a"), ["a1"]);
});

// 2. atleta Sub-13 tentando entrar em turma Sub-11 via API -> rejeitado
test("2 atleta Sub-13 é rejeitado em turma Sub-11", () => {
  const s = initial();
  assert.throws(() => patchTeamRoster(s, orgA, "team-11a", ["a4"]), /category-mismatch/);
  assert.deepEqual(activeMembersOf(s, "team-11a"), []);
});

// 3 + 4. mudar categoria do atleta desativa vínculo incompatível
test("3 mudar categoria do atleta desativa vínculo da turma antiga", () => {
  const s = seededWithA1InTeam11a();
  assert.equal(activeTeamOf(s, "a1"), "team-11a");
  patchAthleteCategory(s, orgA, "a1", "Sub-13");
  assert.equal(activeTeamOf(s, "a1"), null);
  const membership = [...s.memberships.values()].find(
    (m) => m.athleteId === "a1" && m.teamId === "team-11a",
  );
  assert.equal(membership.active, false);
});

test("4 estado final nunca tem categoria divergente com vínculo ativo", () => {
  const s = seededWithA1InTeam11a();
  patchAthleteCategory(s, orgA, "a1", "Sub-13");
  for (const membership of s.memberships.values()) {
    if (!membership.active) continue;
    const athlete = s.athletes.get(membership.athleteId);
    const team = s.teams.get(membership.teamId);
    assert.equal(athlete.category, team.category);
  }
});

// 5. histórico de attendance não é tocado por essa operação — validado via
// regex de fonte abaixo (o fluxo real nunca referencia essas tabelas).

// 6 + 7. remover da turma libera vaga
test("6 remover atleta da turma marca membership como inativo", () => {
  const s = seededWithA1InTeam11a();
  patchTeamRoster(s, orgA, "team-11a", ["a2"]);
  const removed = [...s.memberships.values()].find(
    (m) => m.teamId === "team-11a" && m.athleteId === "a1",
  );
  assert.equal(removed.active, false);
});

test("7 vaga liberada permite novo atleta entrar", () => {
  const s = seededWithA1InTeam11a(); // team-11a capacity 2, cheia com a1,a2
  assert.throws(() => patchTeamRoster(s, orgA, "team-11a", ["a1", "a2", "a3"]));
  patchTeamRoster(s, orgA, "team-11a", ["a2"]); // a1 sai
  patchTeamRoster(s, orgA, "team-11a", ["a2", "a3"]); // vaga ocupada por a3
  assert.deepEqual(activeMembersOf(s, "team-11a"), ["a2", "a3"]);
});

// 8. atleta pode ficar sem turma
test("8 atleta pode ficar sem turma", () => {
  const s = seededWithA1InTeam11a();
  patchTeamRoster(s, orgA, "team-11a", ["a2"]);
  assert.equal(activeTeamOf(s, "a1"), null);
  assert.equal(s.athletes.get("a1").active, true);
});

// 9. tentativa de entrar em turma cheia falha
test("9 turma cheia rejeita nova matrícula", () => {
  const s = initial();
  patchTeamRoster(s, orgA, "team-11a", ["a1", "a2"]); // capacity 2, cheia
  assert.throws(() => patchTeamRoster(s, orgA, "team-11a", ["a1", "a2", "a3"]), /capacity/);
  assert.deepEqual(activeMembersOf(s, "team-11a"), ["a1", "a2"]);
});

// 10. tenant isolation
test("10 atleta de Org A não pode entrar em turma de Org B", () => {
  const s = initial();
  assert.throws(() => patchTeamRoster(s, orgB, "team-b", ["a1"]), /athlete-invalid/);
  assert.deepEqual(activeMembersOf(s, "team-b"), []);
});

test("10b atleta de Org B não pode ser inserido via PATCH de Org A", () => {
  const s = initial();
  assert.throws(() => patchTeamRoster(s, orgA, "team-11a", ["b1"]), /athlete-invalid/);
});

// ------------------------------------------------------------------
// Garantia de que o código real (não só o modelo) contém as correções.
// ------------------------------------------------------------------
const athletePatchSource = readFileSync(
  new URL("../app/api/athletes/[id]/route.ts", import.meta.url),
  "utf8",
);
const teamPatchSource = readFileSync(
  new URL("../app/api/teams/[id]/route.ts", import.meta.url),
  "utf8",
);

test("fonte real: PATCH de atleta desativa team_athletes de turma incompatível ao trocar categoria", () => {
  assert.match(athletePatchSource, /categoryChanged/);
  assert.match(athletePatchSource, /UPDATE team_athletes SET active = 0/);
  assert.match(athletePatchSource, /t\.category != \?/);
});

test("fonte real: desativação de vínculo é soft (nunca DELETE FROM team_athletes)", () => {
  assert.doesNotMatch(athletePatchSource, /DELETE FROM team_athletes/);
});

test("fonte real: PATCH de atleta é atômico via d1.batch", () => {
  assert.match(athletePatchSource, /d1\.batch\(statements\)/);
});

test("fonte real: PATCH de atleta não referencia tabelas financeiras/attendance", () => {
  assert.doesNotMatch(
    athletePatchSource,
    /attendance_sessions|attendance_records|billing_plan|athlete_billing|payments|payment_transactions|ledger|combo/i,
  );
});

test("fonte real: PATCH de turma valida categoria do atleta contra a categoria da turma", () => {
  assert.match(teamPatchSource, /athlete\.category !== value\.category/);
  assert.match(teamPatchSource, /status: 409/);
});

test("fonte real: PATCH de turma continua atômico via d1.batch", () => {
  assert.match(teamPatchSource, /d1\.batch\(statements\)/);
});
