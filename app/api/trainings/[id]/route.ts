import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { teams, trainingDrills, trainingSessions } from "../../../../db/schema";
import { getApiContext } from "../../api-auth";
import { normalizeTraining, type TrainingPayload } from "../training-utils";

export const dynamic = "force-dynamic";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getApiContext(request);
  if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  const normalized = normalizeTraining((await request.json()) as TrainingPayload);
  if ("error" in normalized) return Response.json({ error: normalized.error }, { status: 400 });
  const { id } = await params; const db = getDb(); const { drills, ...session } = normalized.value;
  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(
      and(
        eq(teams.id, session.teamId),
        eq(teams.organizationId, context.membership.organizationId),
        eq(teams.active, true),
      ),
    )
    .limit(1);
  if (!team) return Response.json({ error: "Turma não encontrada." }, { status: 404 });
  const [updated] = await db.update(trainingSessions).set({ ...session, updatedAt: new Date() }).where(and(eq(trainingSessions.id, id), eq(trainingSessions.organizationId, context.membership.organizationId))).returning({ id: trainingSessions.id });
  if (!updated) return Response.json({ error: "Treino não encontrado." }, { status: 404 });
  await db.delete(trainingDrills).where(eq(trainingDrills.sessionId, id));
  await db.insert(trainingDrills).values(drills.map((drill) => ({ id: crypto.randomUUID(), sessionId: id, ...drill })));
  return Response.json({ updated: true });
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getApiContext(request);
  if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  const { id } = await params;
  const [deleted] = await getDb().delete(trainingSessions).where(and(eq(trainingSessions.id, id), eq(trainingSessions.organizationId, context.membership.organizationId))).returning({ id: trainingSessions.id });
  return deleted ? Response.json({ deleted: true }) : Response.json({ error: "Treino não encontrado." }, { status: 404 });
}
