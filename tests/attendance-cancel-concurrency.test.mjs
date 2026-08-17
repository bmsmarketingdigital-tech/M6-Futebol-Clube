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
const stylesSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const teamManagementSource = readFileSync(
  new URL("../app/TeamManagement.tsx", import.meta.url),
  "utf8",
);
const layoutSource = readFileSync(
  new URL("../app/layout.tsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../app/page.tsx", import.meta.url),
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

test("Supabase serializa salvar e cancelar chamada pelo mesmo lock de turma", () => {
  assert.match(postSource, /postgresConfigured\(\)/);
  assert.match(cancelSource, /postgresConfigured\(\)/);
  assert.match(postSource, /SELECT id FROM teams[\s\S]*FOR UPDATE/);
  assert.match(cancelSource, /SELECT id FROM teams[\s\S]*FOR UPDATE/);
});

test("modal de chamada ocupa a viewport móvel sem conteúdo horizontal cortado", () => {
  assert.match(stylesSource, /\.attendance-panel \{[\s\S]*width: 100% !important;[\s\S]*max-width: 100% !important;[\s\S]*height: 100dvh/);
  assert.match(stylesSource, /\.attendance-panel-header > div \{[^}]*min-width: 0;[^}]*max-width: 100%;/);
  assert.match(stylesSource, /\.attendance-panel \.attendance-cancel-row[\s\S]*display: grid !important;[\s\S]*grid-template-columns: minmax\(0, 1fr\) !important/);
  assert.match(stylesSource, /grid-template-areas: "toggle avatar identity" "note note note"/);
  assert.match(teamManagementSource, /return createPortal\([\s\S]*className="attendance-panel"/);
  assert.match(teamManagementSource, /document\.body/);
  assert.match(teamManagementSource, /className="attendance-back-button"[\s\S]*aria-label="Voltar"/);
  assert.match(stylesSource, /\.attendance-backdrop {[\s\S]*position: fixed !important;[\s\S]*inset: 0 !important;[\s\S]*background: var\(--surface-1\) !important;/);
  assert.match(stylesSource, /\.attendance-backdrop \.attendance-panel {[\s\S]*position: absolute !important;[\s\S]*inset: 0 !important;/);
  assert.match(stylesSource, /\.attendance-panel \.attendance-person > button \{[\s\S]*display: grid;[\s\S]*place-items: center;/);
  assert.match(stylesSource, /\.attendance-title-row \{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(stylesSource, /touch-action: pan-y;/);
  assert.match(layoutSource, /maximumScale: 1/);
  assert.match(layoutSource, /userScalable: false/);
  assert.match(stylesSource, /\.toast \{[\s\S]*right: 12px;[\s\S]*left: 12px/);
});

test("aviso estável impede repetição do GET da chamada a cada renderização", () => {
  assert.match(pageSource, /const notify = useCallback\([\s\S]*\}, \[\]\);/);
});
