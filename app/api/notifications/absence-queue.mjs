import { absenceNotificationKey } from "./absence-idempotency.mjs";

const ERROR_FIELD_MAX_LENGTH = 240;

function redactErrorMessage(value) {
  return String(value ?? "")
    .replace(/https?:\/\/[^\s"']+/gi, "[URL]")
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(/\b(password|passwd|token|secret|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[ID]")
    .replace(/\b\d{8,15}\b/g, "[PHONE]")
    .replace(/\bKey \(([^)]+)\)=\(([^)]+)\)/g, "Key ($1)=([REDACTED])")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, ERROR_FIELD_MAX_LENGTH);
}

export function safeAbsenceEnqueueErrorDetails(error) {
  const read = (key) => {
    const value = error && typeof error === "object" ? error[key] : undefined;
    return typeof value === "string" && value.length ? value.slice(0, ERROR_FIELD_MAX_LENGTH) : undefined;
  };
  const message = error instanceof Error ? redactErrorMessage(error.message) : undefined;
  return {
    errorName: error instanceof Error ? error.name : "Error",
    errorCode: read("code") ?? read("errorCode"),
    sqlState: read("sqlState") ?? read("code"),
    constraint: read("constraint"),
    table: read("table"),
    column: read("column"),
    severity: read("severity"),
    message,
  };
}
import { normalizeNotificationPhone } from "./normalize-phone.mjs";

/**
 * @param {{organizationId:string, teamId:string, sessionId:string, teamName:string, date:string,
 * roster:Array<{id:string,name:string}>, submitted:Map<string,{present:boolean,note:string|null}>,
 * phoneByAthleteId:Map<string,string|null>, enqueue:(input:Record<string,unknown>)=>Promise<{created:boolean}>,
 * onError?:(details:Record<string,string>)=>void}} input
 */
export async function queueAbsenceNotifications(input) {
  let queued = 0;
  for (const athlete of input.roster) {
    if (input.submitted.get(athlete.id)?.present !== false) continue;
    const phone = normalizeNotificationPhone(input.phoneByAthleteId.get(athlete.id));
    if (!phone) continue;
    const [year, month, day] = input.date.split("-");
    const message = `Aviso: ${athlete.name} não compareceu ao treino da turma ${input.teamName} hoje (${day}/${month}/${year}).`;
    try {
      const result = await input.enqueue({
        organizationId: input.organizationId,
        athleteId: athlete.id,
        teamId: input.teamId,
        eventType: "absence",
        idempotencyKey: absenceNotificationKey(input.organizationId, input.sessionId, athlete.id),
        phone,
        message,
        maxAttempts: 5,
      });
      if (result.created) queued += 1;
    } catch (error) {
      input.onError?.({
        ...safeAbsenceEnqueueErrorDetails(error),
      });
    }
  }
  return queued;
}
