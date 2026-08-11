import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { athletes, attendanceSessions, classReminders, teamAthletes, teams } from "../../../db/schema";
import { sendWhatsAppMessage } from "../check-in/whatsapp-bridge";

const weekdayCodes = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
type Sender = typeof sendWhatsAppMessage;

export function reminderTargetDate(now = new Date()) {
  const date = new Date(now);
  date.setDate(date.getDate() + 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return { dateStr: `${year}-${month}-${day}`, weekday: weekdayCodes[date.getDay()], formatted: `${day}/${month}/${year}` };
}

export function parseScheduleDays(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((day): day is string => typeof day === "string") : [];
  } catch {
    return [];
  }
}

export function normalizeReminderPhone(value: string | null | undefined) {
  let phone = String(value || "").replace(/\D/g, "");
  if (!phone.startsWith("55") && [10, 11].includes(phone.length)) phone = `55${phone}`;
  return /^55\d{10,11}$/.test(phone) ? phone : "";
}

async function candidateTeams(organizationId: string, target: ReturnType<typeof reminderTargetDate>) {
  const db = getDb();
  const rows = await db.select().from(teams).where(and(eq(teams.organizationId, organizationId), eq(teams.active, true)));
  const candidates = [];
  for (const team of rows) {
    if (!parseScheduleDays(team.scheduleDays).includes(target.weekday)) continue;
    const [alreadySent] = await db.select({ id: classReminders.id }).from(classReminders)
      .where(and(eq(classReminders.teamId, team.id), eq(classReminders.sessionDate, target.dateStr))).limit(1);
    const [session] = await db.select({ status: attendanceSessions.status }).from(attendanceSessions)
      .where(and(eq(attendanceSessions.teamId, team.id), eq(attendanceSessions.sessionDate, target.dateStr))).limit(1);
    if (!alreadySent && session?.status !== "canceled") candidates.push(team);
  }
  return candidates;
}

export async function getClassReminderStatus(organizationId: string, now = new Date()) {
  const target = reminderTargetDate(now);
  const candidates = await candidateTeams(organizationId, target);
  return { date: target.dateStr, weekday: target.weekday, pendingTeams: candidates.length };
}

async function revalidateRecipient(organizationId: string, teamId: string, athleteId: string, target: ReturnType<typeof reminderTargetDate>) {
  const db = getDb();
  const [team] = await db.select({ name: teams.name, scheduleDays: teams.scheduleDays, startTime: teams.startTime, place: teams.place })
    .from(teams).where(and(eq(teams.id, teamId), eq(teams.organizationId, organizationId), eq(teams.active, true))).limit(1);
  if (!team || !parseScheduleDays(team.scheduleDays).includes(target.weekday)) return null;
  const [session] = await db.select({ status: attendanceSessions.status }).from(attendanceSessions)
    .where(and(eq(attendanceSessions.teamId, teamId), eq(attendanceSessions.sessionDate, target.dateStr))).limit(1);
  if (session?.status === "canceled") return null;
  const [recipient] = await db.select({ phone: athletes.guardianPhone }).from(teamAthletes)
    .innerJoin(athletes, eq(teamAthletes.athleteId, athletes.id))
    .where(and(eq(teamAthletes.organizationId, organizationId), eq(teamAthletes.teamId, teamId),
      eq(teamAthletes.athleteId, athleteId), eq(teamAthletes.active, true), eq(athletes.active, true))).limit(1);
  const phone = normalizeReminderPhone(recipient?.phone);
  return phone ? { ...team, phone } : null;
}

export async function processClassReminders(
  organizationId: string,
  dependencies: { sender?: Sender; now?: Date } = {},
) {
  const db = getDb();
  const sender = dependencies.sender ?? sendWhatsAppMessage;
  const target = reminderTargetDate(dependencies.now);
  const candidates = await candidateTeams(organizationId, target);
  let remindersSent = 0;
  let attempted = 0;
  const notifiedTeams: string[] = [];

  for (const team of candidates) {
    const claimed = await db.insert(classReminders)
      .values({ organizationId, teamId: team.id, sessionDate: target.dateStr, sentAt: new Date(), recipientCount: 0 })
      .onConflictDoNothing({ target: [classReminders.teamId, classReminders.sessionDate] })
      .returning({ id: classReminders.id });
    if (claimed.length === 0) continue;
    const roster = await db.select({ athleteId: teamAthletes.athleteId }).from(teamAthletes)
      .where(and(eq(teamAthletes.organizationId, organizationId), eq(teamAthletes.teamId, team.id), eq(teamAthletes.active, true)));
    const usedPhones = new Set<string>();
    let teamAttempts = 0;
    let teamSent = 0;
    for (const member of roster) {
      const current = await revalidateRecipient(organizationId, team.id, member.athleteId, target);
      if (!current || usedPhones.has(current.phone)) continue;
      usedPhones.add(current.phone);
      const message = `Lembrete: amanhã (${target.formatted}) tem treino da turma ${current.name} às ${current.startTime} em ${current.place}.`;
      teamAttempts += 1;
      attempted += 1;
      const delivery = await sender(current.phone, message);
      if (delivery.status === "sent") { teamSent += 1; remindersSent += 1; }
    }
    if (teamAttempts === 0) {
      await db.delete(classReminders).where(eq(classReminders.id, claimed[0].id));
      continue;
    }
    await db.update(classReminders).set({ recipientCount: teamSent }).where(eq(classReminders.id, claimed[0].id));
    if (teamSent > 0) notifiedTeams.push(team.name);
  }
  return { remindersSent, attempted, teams: notifiedTeams };
}
