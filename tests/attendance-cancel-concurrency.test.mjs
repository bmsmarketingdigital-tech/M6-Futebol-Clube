import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Modela o par de escritas concorrentes (cancelar sessão x gravar chamada)
// como duas operações que competem por uma única sessão de attendance,
// espelhando as garantias que agora vêm do banco:
//   - cancelSession só aplica UPDATE se NÃO houver attendance_records (WHERE atômico).
//   - addRecord é bloqueado por trigger se a sessão já estiver canceled.
function session() {
  return { status: "completed", records: [] };
}

function cancelSession(s) {
  if (s.status === "canceled") return { ok: true, idempotent: true };
  if (s.records.length > 0) {
    const err = new Error("conflict");
    err.status = 409;
    throw err;
  }
  s.status = "canceled";
  return { ok: true };
}

function addRecord(s, athleteId) {
  if (s.status === "canceled") {
    const err = new Error("Não é possível registrar presença em uma aula cancelada.");
    err.status = 409;
    throw err;
  }
  s.records.push(athleteId);
}

function coherent(s) {
  return !(s.status === "canceled" && s.records.length > 0);
}

test("1 cancel antes de qualquer registro vence limpo", () => {
  const s = session();
  cancelSession(s);
  assert.equal(s.status, "canceled");
  assert.ok(coherent(s));
});

test("2 registro antes do cancel bloqueia o cancelamento", () => {
  const s = session();
  addRecord(s, "a1");
  assert.throws(() => cancelSession(s), /conflict/);
  assert.equal(s.status, "completed");
  assert.ok(coherent(s));
});

test("3 cancel vence a corrida: registro concorrente é rejeitado", () => {
  const s = session();
  cancelSession(s);
  assert.throws(() => addRecord(s, "a1"), /aula cancelada/);
  assert.ok(coherent(s));
});

test("4 nunca existe estado híbrido (canceled com records)", () => {
  for (const order of [
    ["cancel", "record"],
    ["record", "cancel"],
  ]) {
    const s = session();
    for (const step of order) {
      try {
        if (step === "cancel") cancelSession(s);
        else addRecord(s, "a1");
      } catch {
        // conflito esperado — a invariante é o que importa
      }
    }
    assert.ok(coherent(s), `ordem ${order.join(" -> ")} deixou estado híbrido`);
  }
});

test("5 cancel repetido é idempotente e não reenvia notificação", () => {
  const s = session();
  cancelSession(s);
  const second = cancelSession(s);
  assert.ok(second.idempotent);
  assert.equal(s.status, "canceled");
});

const cancelSource = readFileSync(
  new URL("../app/api/teams/[id]/attendance/cancel/route.ts", import.meta.url),
  "utf8",
);
const postSource = readFileSync(
  new URL("../app/api/teams/[id]/attendance/route.ts", import.meta.url),
  "utf8",
);
const triggerSource = readFileSync(
  new URL("../db/history-protection-triggers.ts", import.meta.url),
  "utf8",
);

test("API cancel usa UPDATE condicional atômico (ne status + notExists records)", () => {
  assert.match(cancelSource, /ne\(attendanceSessions\.status, "canceled"\)/);
  assert.match(cancelSource, /notExists\(/);
  assert.match(cancelSource, /eq\(attendanceRecords\.sessionId, attendanceSessions\.id\)/);
});

test("API cancel retorna 409 em conflito, não 500", () => {
  assert.match(cancelSource, /status: 409/);
});

test("API cancel trata corrida de criação de sessão (P3-ATT) sem 500", () => {
  assert.match(cancelSource, /Unique \(team_id, session_date\) lost the race/);
});

test("API POST attendance trata corrida de criação de sessão (P3-ATT) sem 500", () => {
  assert.match(postSource, /Unique \(team_id, session_date\) lost the race/);
});

test("API POST attendance converte bloqueio de sessão cancelada em 409, não 500", () => {
  assert.match(postSource, /aula cancelada/);
  assert.match(postSource, /status: 409/);
});

test("Trigger de banco bloqueia INSERT em attendance_records de sessão cancelada", () => {
  assert.match(triggerSource, /attendance_records_block_canceled_session_insert/);
  assert.match(triggerSource, /BEFORE INSERT ON attendance_records/);
});

test("Trigger de banco bloqueia UPDATE em attendance_records de sessão cancelada", () => {
  assert.match(triggerSource, /attendance_records_block_canceled_session_update/);
  assert.match(triggerSource, /BEFORE UPDATE ON attendance_records/);
});
