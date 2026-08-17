import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { getPostgresClient, postgresConfigured } from "../../../../db/postgres";
import { athleteEvaluations, athletes } from "../../../../db/schema";
import { getApiContext } from "../../api-auth";
import { normalizeEvaluation, type EvaluationPayload } from "../evaluation-utils";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getApiContext(request);
    if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    const normalized = normalizeEvaluation((await request.json()) as EvaluationPayload, { requireAthlete: false });
    if ("error" in normalized) return Response.json({ error: normalized.error }, { status: 400 });
    const { id } = await params;
    const organizationId = context.membership.organizationId;
    if (postgresConfigured()) {
      const sql = getPostgresClient();
      if (normalized.value.athleteId) {
        const athlete = await sql<{ id: string }[]>`
          SELECT id FROM athletes WHERE id = ${normalized.value.athleteId}
            AND organization_id = ${organizationId} AND active = 1 LIMIT 1
        `;
        if (!athlete[0]) return Response.json({ error: "Atleta não encontrado." }, { status: 404 });
      }
      const updated = normalized.value.athleteId
        ? await sql<{ id: string }[]>`
            UPDATE athlete_evaluations SET athlete_id = ${normalized.value.athleteId},
              evaluation_date = ${normalized.value.evaluationDate}, technical_score = ${normalized.value.technicalScore},
              physical_score = ${normalized.value.physicalScore}, tactical_score = ${normalized.value.tacticalScore},
              behavioral_score = ${normalized.value.behavioralScore}, strengths = ${normalized.value.strengths},
              improvements = ${normalized.value.improvements}, next_goals = ${normalized.value.nextGoals},
              updated_at = ${Math.floor(Date.now() / 1000)}
            WHERE id = ${id} AND organization_id = ${organizationId} RETURNING id
          `
        : await sql<{ id: string }[]>`
            UPDATE athlete_evaluations SET evaluation_date = ${normalized.value.evaluationDate},
              technical_score = ${normalized.value.technicalScore}, physical_score = ${normalized.value.physicalScore},
              tactical_score = ${normalized.value.tacticalScore}, behavioral_score = ${normalized.value.behavioralScore},
              strengths = ${normalized.value.strengths}, improvements = ${normalized.value.improvements},
              next_goals = ${normalized.value.nextGoals}, updated_at = ${Math.floor(Date.now() / 1000)}
            WHERE id = ${id} AND organization_id = ${organizationId} RETURNING id
          `;
      return updated[0] ? Response.json({ evaluation: { id } }) : Response.json({ error: "Avaliação não encontrada." }, { status: 404 });
    }
    const db = getDb();
  if (normalized.value.athleteId) {
    const [athlete] = await db.select({ id: athletes.id }).from(athletes).where(and(
      eq(athletes.id, normalized.value.athleteId),
      eq(athletes.organizationId, organizationId),
      eq(athletes.active, true),
    )).limit(1);
    if (!athlete) return Response.json({ error: "Atleta não encontrado." }, { status: 404 });
  }
  const [updated] = await db.update(athleteEvaluations).set({
    ...normalized.value,
    updatedAt: new Date(),
  }).where(and(eq(athleteEvaluations.id, id), eq(athleteEvaluations.organizationId, organizationId))).returning();
    return updated ? Response.json({ evaluation: updated }) : Response.json({ error: "Avaliação não encontrada." }, { status: 404 });
  } catch (error) {
    console.error("Failed to update evaluation", error);
    return Response.json({ error: "Não foi possível atualizar a avaliação." }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getApiContext(request);
    if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    const { id } = await params;
    if (postgresConfigured()) {
      const deleted = await getPostgresClient()<{ id: string }[]>`
        DELETE FROM athlete_evaluations WHERE id = ${id}
          AND organization_id = ${context.membership.organizationId} RETURNING id
      `;
      return deleted[0] ? Response.json({ deleted: true }) : Response.json({ error: "Avaliação não encontrada." }, { status: 404 });
    }
    const [deleted] = await getDb().delete(athleteEvaluations).where(and(eq(athleteEvaluations.id, id), eq(athleteEvaluations.organizationId, context.membership.organizationId))).returning({ id: athleteEvaluations.id });
    return deleted ? Response.json({ deleted: true }) : Response.json({ error: "Avaliação não encontrada." }, { status: 404 });
  } catch (error) {
    console.error("Failed to delete evaluation", error);
    return Response.json({ error: "Não foi possível excluir a avaliação." }, { status: 500 });
  }
}
