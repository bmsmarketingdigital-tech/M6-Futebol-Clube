import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import { getPostgresClient, postgresConfigured } from "../../../db/postgres";
import { teams, trainingDrills, trainingSessions } from "../../../db/schema";
import { getApiContext } from "../api-auth";
import { normalizeTraining, type TrainingPayload } from "./training-utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    if (postgresConfigured()) {
      const sql = getPostgresClient();
      const rows = await sql<{
        id: string; team_id: string; team_name: string; category: string;
        title: string; objective: string; session_date: string; duration_minutes: number;
        status: "planned" | "completed" | "cancelled"; notes: string | null; created_by: string;
      }[]>`
        SELECT s.id, s.team_id, t.name team_name, t.category, s.title, s.objective,
               s.session_date, s.duration_minutes, s.status, s.notes, s.created_by
        FROM training_sessions s
        INNER JOIN teams t ON t.id = s.team_id AND t.organization_id = s.organization_id
        WHERE s.organization_id = ${context.membership.organizationId}
        ORDER BY s.session_date DESC, s.created_at DESC
        LIMIT 300
      `;
      const drills = rows.length ? await sql<{
        id: string; session_id: string; position: number; name: string; focus: string | null;
        duration_minutes: number; description: string | null;
      }[]>`
        SELECT id, session_id, position, name, focus, duration_minutes, description
        FROM training_drills WHERE session_id = ANY(${rows.map((row) => row.id)})
        ORDER BY session_id, position
      ` : [];
      return Response.json({ trainings: rows.map((row) => ({
        id: row.id, teamId: row.team_id, teamName: row.team_name, category: row.category,
        title: row.title, objective: row.objective, sessionDate: row.session_date,
        durationMinutes: row.duration_minutes, status: row.status, notes: row.notes,
        createdBy: row.created_by,
        drills: drills.filter((drill) => drill.session_id === row.id).map((drill) => ({
          id: drill.id, sessionId: drill.session_id, position: drill.position,
          name: drill.name, focus: drill.focus, durationMinutes: drill.duration_minutes,
          description: drill.description,
        })),
      })) });
    }
    const rows = await getDb().select({
    id: trainingSessions.id, teamId: trainingSessions.teamId, teamName: teams.name,
    category: teams.category, title: trainingSessions.title, objective: trainingSessions.objective,
    sessionDate: trainingSessions.sessionDate, durationMinutes: trainingSessions.durationMinutes,
    status: trainingSessions.status, notes: trainingSessions.notes, createdBy: trainingSessions.createdBy,
  }).from(trainingSessions).innerJoin(teams, eq(teams.id, trainingSessions.teamId))
    .where(eq(trainingSessions.organizationId, context.membership.organizationId))
    .orderBy(desc(trainingSessions.sessionDate)).limit(300);
  const drills = rows.length ? await getDb().select().from(trainingDrills)
    .where(inArray(trainingDrills.sessionId, rows.map((row) => row.id)))
    .orderBy(asc(trainingDrills.position)) : [];
    return Response.json({ trainings: rows.map((row) => ({ ...row, drills: drills.filter((drill) => drill.sessionId === row.id) })) });
  } catch (error) {
    console.error("Failed to list trainings", error);
    return Response.json({ error: "Não foi possível carregar os treinos." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    const normalized = normalizeTraining((await request.json()) as TrainingPayload);
    if ("error" in normalized) return Response.json({ error: normalized.error }, { status: 400 });
    const organizationId = context.membership.organizationId;
    if (postgresConfigured()) {
      const sql = getPostgresClient();
      const team = await sql<{ id: string }[]>`
        SELECT id FROM teams WHERE id = ${normalized.value.teamId}
          AND organization_id = ${organizationId} AND active = 1 LIMIT 1
      `;
      if (!team[0]) return Response.json({ error: "Turma não encontrada." }, { status: 404 });
      const id = crypto.randomUUID(); const now = Math.floor(Date.now() / 1000);
      const { drills, ...session } = normalized.value;
      await sql.begin(async (transaction) => {
        await transaction`
          INSERT INTO training_sessions
            (id, organization_id, team_id, title, objective, session_date, duration_minutes,
             status, notes, created_by, created_at, updated_at)
          VALUES
            (${id}, ${organizationId}, ${session.teamId}, ${session.title}, ${session.objective},
             ${session.sessionDate}, ${session.durationMinutes}, ${session.status}, ${session.notes},
             ${context.user.displayName || context.user.email}, ${now}, ${now})
        `;
        for (const drill of drills) {
          await transaction`
            INSERT INTO training_drills
              (id, session_id, position, name, focus, duration_minutes, description)
            VALUES
              (${crypto.randomUUID()}, ${id}, ${drill.position}, ${drill.name}, ${drill.focus},
               ${drill.durationMinutes}, ${drill.description})
          `;
        }
      });
      return Response.json({ id }, { status: 201 });
    }
    const db = getDb();
    const [team] = await db.select({ id: teams.id }).from(teams).where(and(eq(teams.id, normalized.value.teamId), eq(teams.organizationId, organizationId), eq(teams.active, true))).limit(1);
    if (!team) return Response.json({ error: "Turma não encontrada." }, { status: 404 });
    const id = crypto.randomUUID(); const now = Math.floor(Date.now() / 1000);
    const { drills, ...session } = normalized.value;
    const d1 = getD1();
    // Session + drills must be created atomically: a session without its drills is an invalid,
    // orphaned record (see P0-TRAIN-001).
    await d1.batch([
      d1.prepare(
        `INSERT INTO training_sessions
          (id, organization_id, team_id, title, objective, session_date, duration_minutes, status, notes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id, organizationId, session.teamId, session.title, session.objective, session.sessionDate,
        session.durationMinutes, session.status, session.notes, context.user.displayName || context.user.email, now, now,
      ),
      ...drills.map((drill) =>
        d1.prepare(
          `INSERT INTO training_drills (id, session_id, position, name, focus, duration_minutes, description)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(crypto.randomUUID(), id, drill.position, drill.name, drill.focus, drill.durationMinutes, drill.description),
      ),
    ]);
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    console.error("Failed to create training", error);
    return Response.json({ error: "Não foi possível salvar o treino." }, { status: 500 });
  }
}
