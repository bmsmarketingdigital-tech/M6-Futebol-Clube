import { normalizeNotificationPhone } from "./normalize-phone.mjs";

const normalizePhone = (value) => normalizeNotificationPhone(value) ?? "";

export function parseAbsenceIdempotencyKey(key, organizationId, athleteId) {
  const parts = String(key).split(":");
  if (parts.length !== 4 || parts[0] !== "absence") return null;
  const [, org, sessionId, athlete] = parts;
  return org === organizationId && athlete === athleteId && sessionId ? { sessionId } : null;
}

export function parseEnrollmentIdempotencyKey(key, organizationId, athleteId, teamId) {
  const parts = String(key).split(":");
  if (parts.length !== 4 || parts[0] !== "enrollment") return null;
  const [, org, athlete, team] = parts;
  const expectedTeam = teamId ?? "unassigned";
  return org === organizationId && athlete === athleteId && team === expectedTeam
    ? { teamId: teamId ?? null }
    : null;
}

export function evaluateFinancialSnapshot({ item, current }) {
  if (!current) return { kind: "invalid", reason: "payment_not_found" };
  if (current.organizationId !== item.organizationId || current.athleteId !== item.athleteId) return { kind: "invalid", reason: "financial_event_no_longer_applicable" };
  if (current.status === "cancelled") return { kind: "invalid", reason: "payment_cancelled" };
  if (current.status === "paid") return { kind: "invalid", reason: "payment_already_settled" };
  const amount = Number(current.amountCents);
  const paid = Number(current.paidAmountCents || 0);
  if (!Number.isFinite(amount) || !Number.isFinite(paid) || amount - paid <= 0) return { kind: "invalid", reason: "payment_no_balance" };
  if (!["open", "partial", "overdue"].includes(String(current.status))) return { kind: "invalid", reason: "financial_event_no_longer_applicable" };
  if (!current.athleteActive) return { kind: "invalid", reason: "athlete_inactive" };
  const currentPhone = normalizePhone(current.guardianPhone);
  if (!currentPhone) return { kind: "invalid", reason: "phone_missing" };
  if (currentPhone !== normalizePhone(item.phone)) return { kind: "invalid", reason: "phone_changed" };
  if (!current.enabled) return { kind: "invalid", reason: "notification_disabled" };
  return { kind: "valid", currentPhone };
}

export function evaluateAbsenceSnapshot({ item, session, record, athlete, teamMembership, now = Date.now() }) {
  const reference = parseAbsenceIdempotencyKey(item.idempotencyKey, item.organizationId, item.athleteId);
  if (!reference || !item.teamId) return { kind: "invalid", reason: "absence_reference_mismatch" };
  if (!session) return { kind: "invalid", reason: "attendance_session_not_found" };
  if (session.id !== reference.sessionId) return { kind: "invalid", reason: "absence_reference_mismatch" };
  if (!session || session.organizationId !== item.organizationId || session.teamId !== item.teamId) return { kind: "invalid", reason: "attendance_session_not_found" };
  if (session.status === "canceled") return { kind: "invalid", reason: "attendance_session_cancelled" };
  if (session.status !== "completed") return { kind: "invalid", reason: "attendance_session_not_sendable" };
  if (!record) return { kind: "invalid", reason: "attendance_record_not_found" };
  if (record.athleteId !== item.athleteId || record.present !== false) return { kind: "invalid", reason: "attendance_no_longer_absent" };
  if (!athlete || athlete.organizationId !== item.organizationId) return { kind: "invalid", reason: "athlete_not_found" };
  if (!athlete.active) return { kind: "invalid", reason: "athlete_inactive" };
  if (!teamMembership?.active || teamMembership.teamId !== item.teamId) return { kind: "invalid", reason: "athlete_not_in_team" };
  const phone = normalizePhone(athlete.guardianPhone);
  if (!phone) return { kind: "invalid", reason: "phone_missing" };
  if (phone !== normalizePhone(item.phone)) return { kind: "invalid", reason: "phone_changed" };
  // Session notices expire at the earlier of 2h after enqueue and local São Paulo day-end.
  const endOfLocalDay = Date.parse(`${session.sessionDate}T23:59:59-03:00`);
  const createdAtMs = Number(item.createdAt) * 1000;
  if (!Number.isFinite(endOfLocalDay) || !Number.isFinite(createdAtMs) || now > Math.min(endOfLocalDay, createdAtMs + 2 * 60 * 60 * 1000)) {
    return { kind: "invalid", reason: "notification_expired" };
  }
  return { kind: "valid" };
}

export function evaluateEnrollmentSnapshot({ item, athlete, teamMembership, now = Date.now() }) {
  if (!parseEnrollmentIdempotencyKey(item.idempotencyKey, item.organizationId, item.athleteId, item.teamId)) {
    return { kind: "invalid", reason: "enrollment_reference_mismatch" };
  }
  if (now > Number(item.createdAt) * 1000 + 24 * 60 * 60 * 1000) return { kind: "invalid", reason: "notification_expired" };
  if (!athlete || athlete.organizationId !== item.organizationId) return { kind: "invalid", reason: "athlete_not_found" };
  if (!athlete.active) return { kind: "invalid", reason: "athlete_inactive" };
  if (item.teamId && (!teamMembership?.active || teamMembership.teamId !== item.teamId)) return { kind: "invalid", reason: "athlete_not_in_team" };
  const phone = normalizePhone(athlete.guardianPhone);
  if (!phone) return { kind: "invalid", reason: "phone_missing" };
  if (phone !== normalizePhone(item.phone)) return { kind: "invalid", reason: "phone_changed" };
  return { kind: "valid" };
}
