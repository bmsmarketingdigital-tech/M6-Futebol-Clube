import { absenceNotificationKey } from "./absence-idempotency.mjs";
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
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        athleteId: athlete.id,
        errorName: error instanceof Error ? error.name : "Error",
      });
    }
  }
  return queued;
}
