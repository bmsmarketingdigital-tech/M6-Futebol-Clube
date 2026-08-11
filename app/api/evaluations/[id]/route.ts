import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { athleteEvaluations, athletes } from "../../../../db/schema";
import { getApiContext } from "../../api-auth";
import { normalizeEvaluation, type EvaluationPayload } from "../evaluation-utils";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getApiContext(request);
  if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  const normalized = normalizeEvaluation((await request.json()) as EvaluationPayload, { requireAthlete: false });
  if ("error" in normalized) return Response.json({ error: normalized.error }, { status: 400 });
  const { id } = await params;
  const db = getDb();
  const organizationId = context.membership.organizationId;
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
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getApiContext(request);
  if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  const { id } = await params;
  const [deleted] = await getDb().delete(athleteEvaluations).where(and(eq(athleteEvaluations.id, id), eq(athleteEvaluations.organizationId, context.membership.organizationId))).returning({ id: athleteEvaluations.id });
  return deleted ? Response.json({ deleted: true }) : Response.json({ error: "Avaliação não encontrada." }, { status: 404 });
}
