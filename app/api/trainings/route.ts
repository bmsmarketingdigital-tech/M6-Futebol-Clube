import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { teams, trainingDrills, trainingSessions } from "../../../db/schema";
import { getApiContext } from "../api-auth";
import { normalizeTraining, type TrainingPayload } from "./training-utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getApiContext(request);
  if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
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
}

export async function POST(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    const normalized = normalizeTraining((await request.json()) as TrainingPayload);
    if ("error" in normalized) return Response.json({ error: normalized.error }, { status: 400 });
    const db = getDb(); const organizationId = context.membership.organizationId;
    const [team] = await db.select({ id: teams.id }).from(teams).where(and(eq(teams.id, normalized.value.teamId), eq(teams.organizationId, organizationId), eq(teams.active, true))).limit(1);
    if (!team) return Response.json({ error: "Turma não encontrada." }, { status: 404 });
    const id = crypto.randomUUID(); const now = new Date();
    const { drills, ...session } = normalized.value;
    await db.insert(trainingSessions).values({ id, organizationId, ...session, createdBy: context.user.displayName || context.user.email, createdAt: now, updatedAt: now });
    await db.insert(trainingDrills).values(drills.map((drill) => ({ id: crypto.randomUUID(), sessionId: id, ...drill })));
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    console.error("Failed to create training", error);
    return Response.json({ error: "Não foi possível salvar o treino." }, { status: 500 });
  }
}
