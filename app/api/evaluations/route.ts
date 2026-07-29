import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { athleteEvaluations, athletes } from "../../../db/schema";
import { getApiContext } from "../api-auth";
import {
  evaluationDto,
  normalizeEvaluation,
  type EvaluationPayload,
} from "./evaluation-utils";

export const dynamic = "force-dynamic";
const selection = {
  id: athleteEvaluations.id,
  athleteId: athleteEvaluations.athleteId,
  athleteName: athletes.fullName,
  category: athletes.category,
  evaluationDate: athleteEvaluations.evaluationDate,
  technicalScore: athleteEvaluations.technicalScore,
  physicalScore: athleteEvaluations.physicalScore,
  tacticalScore: athleteEvaluations.tacticalScore,
  behavioralScore: athleteEvaluations.behavioralScore,
  strengths: athleteEvaluations.strengths,
  improvements: athleteEvaluations.improvements,
  nextGoals: athleteEvaluations.nextGoals,
  evaluatedBy: athleteEvaluations.evaluatedBy,
};

export async function GET(request: Request) {
  const context = await getApiContext(request);
  if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  const athleteId = new URL(request.url).searchParams.get("athleteId");
  const conditions = [
    eq(athleteEvaluations.organizationId, context.membership.organizationId),
  ];
  if (athleteId) conditions.push(eq(athleteEvaluations.athleteId, athleteId));
  const rows = await getDb()
    .select(selection)
    .from(athleteEvaluations)
    .innerJoin(athletes, eq(athletes.id, athleteEvaluations.athleteId))
    .where(and(...conditions))
    .orderBy(desc(athleteEvaluations.evaluationDate))
    .limit(500);
  return Response.json({ evaluations: rows.map(evaluationDto) });
}

export async function POST(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    const normalized = normalizeEvaluation((await request.json()) as EvaluationPayload);
    if ("error" in normalized) return Response.json({ error: normalized.error }, { status: 400 });
    const db = getDb();
    const organizationId = context.membership.organizationId;
    const [athlete] = await db
      .select({ id: athletes.id })
      .from(athletes)
      .where(and(eq(athletes.id, normalized.value.athleteId), eq(athletes.organizationId, organizationId), eq(athletes.active, true)))
      .limit(1);
    if (!athlete) return Response.json({ error: "Atleta não encontrado." }, { status: 404 });
    const now = new Date();
    const [created] = await db.insert(athleteEvaluations).values({
      id: crypto.randomUUID(),
      organizationId,
      ...normalized.value,
      evaluatedBy: context.user.displayName || context.user.email,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return Response.json({ evaluation: created }, { status: 201 });
  } catch (error) {
    console.error("Failed to create evaluation", error);
    return Response.json({ error: "Não foi possível salvar a avaliação." }, { status: 500 });
  }
}
