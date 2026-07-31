import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  athletes,
  attendanceSessions,
  classReminders,
  teamAthletes,
  teams,
} from "../../../db/schema";
import { getApiContext } from "../api-auth";
import { sendWhatsAppMessage } from "../check-in/whatsapp-bridge";

export const dynamic = "force-dynamic";

const weekdayCodes = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function tomorrow() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return {
    dateStr: `${year}-${month}-${day}`,
    weekday: weekdayCodes[date.getDay()],
    formatted: `${day}/${month}/${year}`,
  };
}

function parseScheduleDays(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((day): day is string => typeof day === "string");
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json(
        { error: "Faça login para verificar lembretes." },
        { status: 401 },
      );
    }

    const organizationId = context.membership.organizationId;
    const { dateStr, weekday, formatted } = tomorrow();
    const db = getDb();

    const activeTeams = await db
      .select()
      .from(teams)
      .where(
        and(eq(teams.organizationId, organizationId), eq(teams.active, true)),
      );

    let remindersSent = 0;
    const notifiedTeams: string[] = [];

    for (const team of activeTeams) {
      if (!parseScheduleDays(team.scheduleDays).includes(weekday)) continue;

      const [alreadySent] = await db
        .select({ id: classReminders.id })
        .from(classReminders)
        .where(
          and(
            eq(classReminders.teamId, team.id),
            eq(classReminders.sessionDate, dateStr),
          ),
        )
        .limit(1);
      if (alreadySent) continue;

      const [session] = await db
        .select({ status: attendanceSessions.status })
        .from(attendanceSessions)
        .where(
          and(
            eq(attendanceSessions.teamId, team.id),
            eq(attendanceSessions.sessionDate, dateStr),
          ),
        )
        .limit(1);
      if (session?.status === "canceled") continue;

      const roster = await db
        .select({ guardianPhone: athletes.guardianPhone })
        .from(teamAthletes)
        .innerJoin(athletes, eq(teamAthletes.athleteId, athletes.id))
        .where(
          and(
            eq(teamAthletes.teamId, team.id),
            eq(teamAthletes.organizationId, organizationId),
            eq(teamAthletes.active, true),
            eq(athletes.active, true),
          ),
        );

      const phones = new Set<string>();
      for (const athlete of roster) {
        if (athlete.guardianPhone) phones.add(athlete.guardianPhone);
      }

      let sentCount = 0;
      if (phones.size > 0) {
        const message = `Lembrete: amanhã (${formatted}) tem treino da turma ${team.name} às ${team.startTime} em ${team.place}.`;
        for (const phone of phones) {
          const delivery = await sendWhatsAppMessage(phone, message);
          if (delivery.status === "sent") sentCount += 1;
        }
      }

      await db.insert(classReminders).values({
        organizationId,
        teamId: team.id,
        sessionDate: dateStr,
        sentAt: new Date(),
        recipientCount: sentCount,
      });

      if (sentCount > 0) {
        remindersSent += sentCount;
        notifiedTeams.push(team.name);
      }
    }

    return Response.json({ remindersSent, teams: notifiedTeams });
  } catch (error) {
    console.error("Failed to run class reminders", error);
    return Response.json(
      { error: "Não foi possível verificar os lembretes." },
      { status: 500 },
    );
  }
}
