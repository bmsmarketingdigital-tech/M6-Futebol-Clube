import { and, asc, eq, inArray } from "drizzle-orm";
import { getD1, getDb } from "../../../../../db";
import { getPostgresClient, postgresConfigured } from "../../../../../db/postgres";
import {
  athletes,
  attendanceRecords,
  attendanceSessions,
  teamAthletes,
  teams,
} from "../../../../../db/schema";
import { getApiContext } from "../../../api-auth";
import { sendWhatsAppMessage } from "../../../check-in/whatsapp-bridge";

export const dynamic = "force-dynamic";

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function formatDateBR(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

// Só notifica falta quando a chamada do dia é feita pela primeira vez —
// reabrir e corrigir uma chamada já salva (edição) não deve reenviar
// mensagem para quem já foi avisado. Notifica ausência (não presença): o
// caso real é o atleta dizer em casa que vai treinar, não aparecer, e o
// responsável só descobrir pela chamada.
async function notifyAbsentGuardians(
  organizationId: string,
  teamName: string,
  date: string,
  roster: { id: string; name: string }[],
  submitted: Map<string, { present: boolean; note: string | null }>,
) {
  const absentAthletes = roster.filter(
    (athlete) => submitted.get(athlete.id)?.present === false,
  );
  if (absentAthletes.length === 0) return 0;
  const absentIds = absentAthletes.map((athlete) => athlete.id);

  let phoneByAthleteId: Map<string, string | null>;
  if (postgresConfigured()) {
    const sqlClient = getPostgresClient();
    const rows = await sqlClient<{ id: string; guardian_phone: string | null }[]>`
      SELECT id, guardian_phone FROM athletes
      WHERE organization_id = ${organizationId}
        AND id IN ${sqlClient(absentIds)}`;
    phoneByAthleteId = new Map(rows.map((row) => [row.id, row.guardian_phone]));
  } else {
    const db = getDb();
    const rows = await db
      .select({ id: athletes.id, guardianPhone: athletes.guardianPhone })
      .from(athletes)
      .where(
        and(
          eq(athletes.organizationId, organizationId),
          inArray(athletes.id, absentIds),
        ),
      );
    phoneByAthleteId = new Map(rows.map((row) => [row.id, row.guardianPhone]));
  }

  let notified = 0;
  for (const athlete of absentAthletes) {
    const phone = phoneByAthleteId.get(athlete.id);
    if (!phone) continue;
    const message =
      `Aviso: ${athlete.name} não compareceu ao treino da turma ` +
      `${teamName} hoje (${formatDateBR(date)}).`;
    const delivery = await sendWhatsAppMessage(phone, message);
    if (delivery.status === "sent") notified += 1;
  }
  return notified;
}

async function getAuthorizedTeam(request: Request, teamId: string) {
  const context = await getApiContext(request);
  if (!context) return null;

  if (postgresConfigured()) {
    const rows = await getPostgresClient()<{
      id: string; name: string; category: string; start_time: string;
    }[]>`
      SELECT id, name, category, start_time
      FROM teams
      WHERE id = ${teamId}
        AND organization_id = ${context.membership.organizationId}
        AND active = 1
      LIMIT 1`;
    const team = rows[0];
    return team
      ? { context, team: { ...team, startTime: team.start_time } }
      : null;
  }

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
  if (postgresConfigured()) {
    return getPostgresClient()<{ id: string; name: string; category: string; attendance: number }[]>`
      SELECT a.id, a.full_name name, a.category, a.attendance_rate attendance
      FROM team_athletes ta
      INNER JOIN athletes a
        ON a.id = ta.athlete_id AND a.organization_id = ta.organization_id
      WHERE ta.team_id = ${teamId}
        AND ta.organization_id = ${organizationId}
        AND ta.active = 1 AND a.active = 1
      ORDER BY lower(a.full_name)`;
  }

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
    let session: { id: string; status: string; cancelReason: string | null } | undefined;
    let savedRecords: Array<{ athleteId: string; present: boolean; note: string | null }> = [];
    if (postgresConfigured()) {
      const sql = getPostgresClient();
      const sessions = await sql<{ id: string; status: string; cancel_reason: string | null }[]>`
        SELECT id, status, cancel_reason
        FROM attendance_sessions
        WHERE team_id = ${id} AND session_date = ${date}
        LIMIT 1`;
      const current = sessions[0];
      session = current
        ? { id: current.id, status: current.status, cancelReason: current.cancel_reason }
        : undefined;
      if (session) {
        const records = await sql<{ athlete_id: string; present: number; note: string | null }[]>`
          SELECT athlete_id, present, note
          FROM attendance_records WHERE session_id = ${session.id}`;
        savedRecords = records.map((record) => ({
          athleteId: record.athlete_id,
          present: Boolean(record.present),
          note: record.note,
        }));
      }
    } else {
      const db = getDb();
      [session] = await db
        .select({
          id: attendanceSessions.id,
          status: attendanceSessions.status,
          cancelReason: attendanceSessions.cancelReason,
        })
        .from(attendanceSessions)
        .where(and(eq(attendanceSessions.teamId, id), eq(attendanceSessions.sessionDate, date)))
        .limit(1);
      savedRecords = session
        ? await db
            .select({ athleteId: attendanceRecords.athleteId, present: attendanceRecords.present, note: attendanceRecords.note })
            .from(attendanceRecords)
            .where(eq(attendanceRecords.sessionId, session.id))
        : [];
    }
    const savedByAthlete = new Map(
      savedRecords.map((record) => [record.athleteId, record]),
    );
    const canceled = session?.status === "canceled";

    return Response.json({
      team: {
        id: authorized.team.id,
        name: authorized.team.name,
        category: authorized.team.category,
        startTime: authorized.team.startTime,
      },
      date,
      saved: savedRecords.length > 0,
      canceled,
      cancelReason: canceled ? session?.cancelReason ?? null : null,
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

    if (postgresConfigured()) {
      const organizationId = authorized.context.membership.organizationId;
      const result = await getPostgresClient().begin(async (transaction) => {
        await transaction`SELECT id FROM teams
          WHERE id = ${id} AND organization_id = ${organizationId} FOR UPDATE`;
        let sessions = await transaction<{ id: string; status: string }[]>`
          SELECT id, status FROM attendance_sessions
          WHERE team_id = ${id} AND session_date = ${date} FOR UPDATE`;
        if (sessions[0]?.status === "canceled") return { conflict: true as const };
        const isNewSession = !sessions[0];
        if (isNewSession) {
          const sessionId = crypto.randomUUID();
          await transaction`
            INSERT INTO attendance_sessions
              (id, organization_id, team_id, session_date, recorded_by, status, created_at)
            VALUES (${sessionId}, ${organizationId}, ${id}, ${date},
              ${authorized.context.user.email}, 'completed', ${Math.floor(Date.now() / 1000)})
            ON CONFLICT (team_id, session_date) DO NOTHING`;
          sessions = await transaction<{ id: string; status: string }[]>`
            SELECT id, status FROM attendance_sessions
            WHERE team_id = ${id} AND session_date = ${date} FOR UPDATE`;
        }
        if (!sessions[0] || sessions[0].status === "canceled") return { conflict: true as const };

        for (const athlete of roster) {
          const record = submitted.get(athlete.id) ?? { present: true, note: null };
          await transaction`
            INSERT INTO attendance_records (session_id, athlete_id, present, note)
            VALUES (${sessions[0].id}, ${athlete.id}, ${record.present ? 1 : 0}, ${record.note})
            ON CONFLICT (session_id, athlete_id) DO UPDATE
              SET present = EXCLUDED.present, note = EXCLUDED.note`;
          await transaction`
            UPDATE athletes SET
              attendance_rate = COALESCE((
                SELECT ROUND(100.0 * SUM(CASE WHEN present = 1 THEN 1 ELSE 0 END) / COUNT(*))::integer
                FROM attendance_records WHERE athlete_id = ${athlete.id}
              ), attendance_rate),
              updated_at = ${Math.floor(Date.now() / 1000)}
            WHERE id = ${athlete.id} AND organization_id = ${organizationId}`;
        }
        return { conflict: false as const, isNewSession };
      });
      if (result.conflict) {
        return Response.json(
          { error: "Esta data está marcada como aula cancelada. Reabra a aula antes de fazer a chamada." },
          { status: 409 },
        );
      }
      const presentCount = roster.filter((athlete) => submitted.get(athlete.id)?.present !== false).length;
      const notified = result.isNewSession
        ? await notifyAbsentGuardians(organizationId, authorized.team.name, date, roster, submitted)
        : 0;
      return Response.json({
        saved: true, date, total: roster.length, present: presentCount,
        absent: roster.length - presentCount, notified,
      });
    }

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

    if (session && session.status === "canceled") {
      return Response.json(
        {
          error:
            "Esta data está marcada como aula cancelada. Reabra a aula antes de fazer a chamada.",
        },
        { status: 409 },
      );
    }

    const isNewSession = !session;
    if (!session) {
      try {
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
      } catch {
        // Unique (team_id, session_date) lost the race to a concurrent request
        // that created the session first (P3-ATT) — reload instead of 500ing.
        [session] = await db
          .select()
          .from(attendanceSessions)
          .where(
            and(
              eq(attendanceSessions.teamId, id),
              eq(attendanceSessions.sessionDate, date),
            ),
          )
          .limit(1);
        if (!session) throw new Error("Falha ao criar a chamada.");
      }
      if (session.status === "canceled") {
        return Response.json(
          {
            error:
              "Esta data está marcada como aula cancelada. Reabra a aula antes de fazer a chamada.",
          },
          { status: 409 },
        );
      }
    }

    try {
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
    } catch (error) {
      // The session may have been canceled concurrently (P1-ATT): a DB trigger
      // blocks writing attendance_records into a canceled session, which
      // surfaces here as an insert/update failure rather than a plain 500.
      if (error instanceof Error && error.message.includes("aula cancelada")) {
        return Response.json(
          {
            error:
              "Esta data foi marcada como aula cancelada durante o registro. Reabra a aula antes de fazer a chamada.",
          },
          { status: 409 },
        );
      }
      throw error;
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
    const notified = isNewSession
      ? await notifyAbsentGuardians(
          authorized.context.membership.organizationId,
          authorized.team.name,
          date,
          roster,
          submitted,
        )
      : 0;
    return Response.json({
      saved: true,
      date,
      total: roster.length,
      present: presentCount,
      absent: roster.length - presentCount,
      notified,
    });
  } catch (error) {
    console.error("Failed to save attendance", error);
    return Response.json(
      { error: "Não foi possível salvar a chamada." },
      { status: 500 },
    );
  }
}
