import { and, asc, eq, inArray } from "drizzle-orm";
import { getD1, getDb } from "../../../../../db";
import {
  athletes,
  attendanceRecords,
  attendanceSessions,
  teamAthletes,
  teams,
} from "../../../../../db/schema";
import { getApiContext } from "../../../api-auth";

export const dynamic = "force-dynamic";

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

async function getAuthorizedTeam(request: Request, teamId: string) {
  const context = await getApiContext(request);
  if (!context) return null;

  const db = getDb();
  const [team] = await db
    .select()
    .from(teams)
    .where(
      and(
        eq(teams.id, teamId),
        eq(teams.organizationId, context.membership.organizationId),
        eq(teams.active, true),
      ),
    )
    .limit(1);

  return team ? { context, team } : null;
}

async function getRoster(teamId: string, organizationId: string) {
  const db = getDb();
  return db
    .select({
      id: athletes.id,
      name: athletes.fullName,
      category: athletes.category,
      attendance: athletes.attendanceRate,
    })
    .from(teamAthletes)
    .innerJoin(athletes, eq(teamAthletes.athleteId, athletes.id))
    .where(
      and(
        eq(teamAthletes.teamId, teamId),
        eq(teamAthletes.organizationId, organizationId),
        eq(teamAthletes.active, true),
        eq(athletes.active, true),
      ),
    )
    .orderBy(asc(athletes.fullName));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const date = new URL(request.url).searchParams.get("date") ?? "";
    if (!validDate(date)) {
      return Response.json({ error: "Informe uma data válida." }, { status: 400 });
    }

    const authorized = await getAuthorizedTeam(request, id);
    if (!authorized) {
      return Response.json({ error: "Turma não encontrada." }, { status: 404 });
    }

    const roster = await getRoster(
      id,
      authorized.context.membership.organizationId,
    );
    const db = getDb();
    const [session] = await db
      .select({ id: attendanceSessions.id })
      .from(attendanceSessions)
      .where(
        and(
          eq(attendanceSessions.teamId, id),
          eq(attendanceSessions.sessionDate, date),
        ),
      )
      .limit(1);

    const savedRecords = session
      ? await db
          .select({
            athleteId: attendanceRecords.athleteId,
            present: attendanceRecords.present,
            note: attendanceRecords.note,
          })
          .from(attendanceRecords)
          .where(eq(attendanceRecords.sessionId, session.id))
      : [];
    const savedByAthlete = new Map(
      savedRecords.map((record) => [record.athleteId, record]),
    );

    return Response.json({
      team: {
        id: authorized.team.id,
        name: authorized.team.name,
        category: authorized.team.category,
        startTime: authorized.team.startTime,
      },
      date,
      saved: Boolean(session),
      athletes: roster.map((athlete) => {
        const saved = savedByAthlete.get(athlete.id);
        return {
          ...athlete,
          initials: athlete.name
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0])
            .join("")
            .toUpperCase(),
          present: saved?.present ?? true,
          note: saved?.note ?? "",
        };
      }),
    });
  } catch (error) {
    console.error("Failed to load attendance", error);
    return Response.json(
      { error: "Não foi possível carregar a chamada." },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const payload = (await request.json()) as {
      date?: string;
      records?: Array<{ athleteId?: string; present?: boolean; note?: string }>;
    };
    const date = payload.date?.trim() ?? "";
    if (!validDate(date)) {
      return Response.json({ error: "Informe uma data válida." }, { status: 400 });
    }

    const authorized = await getAuthorizedTeam(request, id);
    if (!authorized) {
      return Response.json({ error: "Turma não encontrada." }, { status: 404 });
    }

    const roster = await getRoster(
      id,
      authorized.context.membership.organizationId,
    );
    if (roster.length === 0) {
      return Response.json(
        { error: "Adicione atletas à turma antes de realizar a chamada." },
        { status: 400 },
      );
    }

    const submitted = new Map(
      (payload.records ?? [])
        .filter((record) => typeof record.athleteId === "string")
        .map((record) => [
          record.athleteId!,
          {
            present: record.present !== false,
            note: record.note?.trim().slice(0, 240) || null,
          },
        ]),
    );

    const db = getDb();
    let [session] = await db
      .select()
      .from(attendanceSessions)
      .where(
        and(
          eq(attendanceSessions.teamId, id),
          eq(attendanceSessions.sessionDate, date),
        ),
      )
      .limit(1);

    if (!session) {
      [session] = await db
        .insert(attendanceSessions)
        .values({
          id: crypto.randomUUID(),
          organizationId: authorized.context.membership.organizationId,
          teamId: id,
          sessionDate: date,
          recordedBy: authorized.context.user.email,
          createdAt: new Date(),
        })
        .returning();
    }

    for (const athlete of roster) {
      const record = submitted.get(athlete.id) ?? {
        present: true,
        note: null,
      };
      await db
        .insert(attendanceRecords)
        .values({
          sessionId: session.id,
          athleteId: athlete.id,
          present: record.present,
          note: record.note,
        })
        .onConflictDoUpdate({
          target: [
            attendanceRecords.sessionId,
            attendanceRecords.athleteId,
          ],
          set: {
            present: record.present,
            note: record.note,
          },
        });
    }

    const d1 = getD1();
    const updatedAt = Math.floor(Date.now() / 1000);
    await d1.batch(
      roster.map((athlete) =>
        d1
          .prepare(`UPDATE athletes
            SET attendance_rate = COALESCE((
              SELECT ROUND(100.0 * SUM(CASE WHEN present = 1 THEN 1 ELSE 0 END) / COUNT(*))
              FROM attendance_records
              WHERE athlete_id = ?
            ), attendance_rate),
            updated_at = ?
            WHERE id = ? AND organization_id = ?`)
          .bind(
            athlete.id,
            updatedAt,
            athlete.id,
            authorized.context.membership.organizationId,
          ),
      ),
    );

    const presentCount = roster.filter(
      (athlete) => submitted.get(athlete.id)?.present !== false,
    ).length;
    return Response.json({
      saved: true,
      date,
      total: roster.length,
      present: presentCount,
      absent: roster.length - presentCount,
    });
  } catch (error) {
    console.error("Failed to save attendance", error);
    return Response.json(
      { error: "Não foi possível salvar a chamada." },
      { status: 500 },
    );
  }
}
