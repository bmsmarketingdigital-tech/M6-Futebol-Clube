/** @param {string} organizationId @param {string} sessionId @param {string} athleteId */
export function absenceNotificationKey(organizationId, sessionId, athleteId) {
  return `absence:${organizationId}:${sessionId}:${athleteId}`;
}
