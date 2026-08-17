import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { getPostgresClient, postgresConfigured } from "../../../../db/postgres";
import { teams, trainingSessions } from "../../../../db/schema";
import { getApiContext } from "../../api-auth";
import { normalizeTraining, type TrainingPayload } from "../training-utils";

export const dynamic = "force-dynamic";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getApiContext(request);
    if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    const normalized = normalizeTraining((await request.json()) as TrainingPayload);
    if ("error" in normalized) return Response.json({ error: normalized.error }, { status: 400 });
    const { id } = await params; const organizationId = context.membership.organizationId;
    const { drills, ...session } = normalized.value;
    if (postgresConfigured()) {
      const sql = getPostgresClient();
      const team = await sql<{ id: string }[]>`
        SELECT id FROM teams WHERE id = ${session.teamId}
          AND organization_id = ${organizationId} AND active = 1 LIMIT 1
      `;
      if (!team[0]) return Response.json({ error: "Turma não encontrada." }, { status: 404 });
      const updated = await sql.begin(async (transaction) => {
        const rows = await transaction<{ id: string }[]>`
          UPDATE training_sessions SET team_id = ${session.teamId}, title = ${session.title},
            objective = ${session.objective}, session_date = ${session.sessionDate},
            duration_minutes = ${session.durationMinutes}, status = ${session.status},
            notes = ${session.notes}, updated_at = ${Math.floor(Date.now() / 1000)}
          WHERE id = ${id} AND organization_id = ${organizationId} RETURNING id
        `;
        if (!rows[0]) return false;
        await transaction`DELETE FROM training_drills WHERE session_id = ${id}`;
        for (const drill of drills) {
          await transaction`
            INSERT INTO training_drills
              (id, session_id, position, name, focus, duration_minutes, description)
            VALUES (${crypto.randomUUID()}, ${id}, ${drill.position}, ${drill.name}, ${drill.focus},
                    ${drill.durationMinutes}, ${drill.description})
          `;
        }
        return true;
      });
      return updated ? Response.json({ updated: true }) : Response.json({ error: "Treino não encontrado." }, { status: 404 });
    }
    const db = getDb();
  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(
      and(
        eq(teams.id, session.teamId),
        eq(teams.organizationId, organizationId),
        eq(teams.active, true),
      ),
    )
    .limit(1);
  if (!team) return Response.json({ error: "Turma não encontrada." }, { status: 404 });
  const now = Math.floor(Date.now() / 1000);
  const d1 = getD1();
  // Update + drill replace must be atomic: a partial write would leave the session either
  // with stale drills or with none at all (see P0-TRAIN-001). The delete/insert statements
  // re-check organization ownership via EXISTS so a wrong-tenant id can never insert drills.
  const results = await d1.batch([
    d1.prepare(
      `UPDATE training_sessions SET team_id = ?, title = ?, objective = ?, session_date = ?,
         duration_minutes = ?, status = ?, notes = ?, updated_at = ?
       WHERE id = ? AND organization_id = ?`,
    ).bind(
      session.teamId, session.title, session.objective, session.sessionDate,
      session.durationMinutes, session.status, session.notes, now, id, organizationId,
    ),
    d1.prepare(
      `DELETE FROM training_drills
       WHERE session_id = ?
         AND EXISTS (SELECT 1 FROM training_sessions ts WHERE ts.id = ? AND ts.organization_id = ?)`,
    ).bind(id, id, organizationId),
    ...drills.map((drill) =>
      d1.prepare(
        `INSERT INTO training_drills (id, session_id, position, name, focus, duration_minutes, description)
         SELECT ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM training_sessions ts WHERE ts.id = ? AND ts.organization_id = ?)`,
      ).bind(
        crypto.randomUUID(), id, drill.position, drill.name, drill.focus, drill.durationMinutes, drill.description,
        id, organizationId,
      ),
    ),
  ]);
  if ((results[0].meta.changes ?? 0) !== 1) return Response.json({ error: "Treino não encontrado." }, { status: 404 });
    return Response.json({ updated: true });
  } catch (error) {
    console.error("Failed to update training", error);
    return Response.json({ error: "Não foi possível atualizar o treino." }, { status: 500 });
  }
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getApiContext(request);
    if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    const { id } = await params;
    if (postgresConfigured()) {
      const deleted = await getPostgresClient()<{ id: string }[]>`
        DELETE FROM training_sessions WHERE id = ${id}
          AND organization_id = ${context.membership.organizationId} RETURNING id
      `;
      return deleted[0] ? Response.json({ deleted: true }) : Response.json({ error: "Treino não encontrado." }, { status: 404 });
    }
    const [deleted] = await getDb().delete(trainingSessions).where(and(eq(trainingSessions.id, id), eq(trainingSessions.organizationId, context.membership.organizationId))).returning({ id: trainingSessions.id });
    return deleted ? Response.json({ deleted: true }) : Response.json({ error: "Treino não encontrado." }, { status: 404 });
  } catch (error) {
    console.error("Failed to delete training", error);
    return Response.json({ error: "Não foi possível excluir o treino." }, { status: 500 });
  }
}
