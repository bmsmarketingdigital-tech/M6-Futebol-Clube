import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { athleteEvaluations } from "../../../../db/schema";
import { getApiContext } from "../../api-auth";
import { normalizeEvaluation, type EvaluationPayload } from "../evaluation-utils";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getApiContext(request);
  if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  const normalized = normalizeEvaluation((await request.json()) as EvaluationPayload);
  if ("error" in normalized) return Response.json({ error: normalized.error }, { status: 400 });
  const { id } = await params;
  const [updated] = await getDb().update(athleteEvaluations).set({
    ...normalized.value,
    updatedAt: new Date(),
  }).where(and(eq(athleteEvaluations.id, id), eq(athleteEvaluations.organizationId, context.membership.organizationId))).returning();
  return updated ? Response.json({ evaluation: updated }) : Response.json({ error: "Avaliação não encontrada." }, { status: 404 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getApiContext(request);
  if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  const { id } = await params;
  const [deleted] = await getDb().delete(athleteEvaluations).where(and(eq(athleteEvaluations.id, id), eq(athleteEvaluations.organizationId, context.membership.organizationId))).returning({ id: athleteEvaluations.id });
  return deleted ? Response.json({ deleted: true }) : Response.json({ error: "Avaliação não encontrada." }, { status: 404 });
}
