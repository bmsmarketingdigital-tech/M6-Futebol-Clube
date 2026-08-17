import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { getPostgresClient, postgresConfigured } from "../../../db/postgres";
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
  try {
    const context = await getApiContext(request);
    if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    const athleteId = new URL(request.url).searchParams.get("athleteId");
    if (postgresConfigured()) {
      const sql = getPostgresClient();
      const rows = await sql<{
        id: string; athlete_id: string; athlete_name: string; category: string;
        evaluation_date: string; technical_score: number; physical_score: number;
        tactical_score: number; behavioral_score: number; strengths: string | null;
        improvements: string | null; next_goals: string | null; evaluated_by: string;
      }[]>`
        SELECT e.id, e.athlete_id, a.full_name athlete_name, a.category,
               e.evaluation_date, e.technical_score, e.physical_score,
               e.tactical_score, e.behavioral_score, e.strengths,
               e.improvements, e.next_goals, e.evaluated_by
        FROM athlete_evaluations e
        INNER JOIN athletes a
          ON a.id = e.athlete_id AND a.organization_id = e.organization_id
        WHERE e.organization_id = ${context.membership.organizationId}
          AND (${athleteId}::text IS NULL OR e.athlete_id = ${athleteId})
        ORDER BY e.evaluation_date DESC, e.created_at DESC
        LIMIT 500
      `;
      return Response.json({
        evaluations: rows.map((row) => evaluationDto({
          id: row.id, athleteId: row.athlete_id, athleteName: row.athlete_name,
          category: row.category, evaluationDate: row.evaluation_date,
          technicalScore: row.technical_score, physicalScore: row.physical_score,
          tacticalScore: row.tactical_score, behavioralScore: row.behavioral_score,
          strengths: row.strengths, improvements: row.improvements,
          nextGoals: row.next_goals, evaluatedBy: row.evaluated_by,
        })),
      });
    }
    const conditions = [eq(athleteEvaluations.organizationId, context.membership.organizationId)];
    if (athleteId) conditions.push(eq(athleteEvaluations.athleteId, athleteId));
    const rows = await getDb().select(selection).from(athleteEvaluations)
      .innerJoin(athletes, and(eq(athletes.id, athleteEvaluations.athleteId), eq(athletes.organizationId, athleteEvaluations.organizationId)))
      .where(and(...conditions)).orderBy(desc(athleteEvaluations.evaluationDate)).limit(500);
    return Response.json({ evaluations: rows.map(evaluationDto) });
  } catch (error) {
    console.error("Failed to list evaluations", error);
    return Response.json({ error: "Não foi possível carregar as avaliações." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    const normalized = normalizeEvaluation((await request.json()) as EvaluationPayload, { requireAthlete: true });
    if ("error" in normalized) return Response.json({ error: normalized.error }, { status: 400 });
    const organizationId = context.membership.organizationId;
    const athleteId = normalized.value.athleteId!;
    if (postgresConfigured()) {
      const sql = getPostgresClient();
      const athlete = await sql<{ id: string }[]>`
        SELECT id FROM athletes
        WHERE id = ${athleteId} AND organization_id = ${organizationId} AND active = 1
        LIMIT 1
      `;
      if (!athlete[0]) return Response.json({ error: "Atleta não encontrado." }, { status: 404 });
      const id = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      await sql`
        INSERT INTO athlete_evaluations
          (id, organization_id, athlete_id, evaluation_date, technical_score,
           physical_score, tactical_score, behavioral_score, strengths,
           improvements, next_goals, evaluated_by, created_at, updated_at)
        VALUES
          (${id}, ${organizationId}, ${athleteId}, ${normalized.value.evaluationDate},
           ${normalized.value.technicalScore}, ${normalized.value.physicalScore},
           ${normalized.value.tacticalScore}, ${normalized.value.behavioralScore},
           ${normalized.value.strengths}, ${normalized.value.improvements},
           ${normalized.value.nextGoals}, ${context.user.displayName || context.user.email},
           ${now}, ${now})
      `;
      return Response.json({ evaluation: { id } }, { status: 201 });
    }
    const db = getDb();
    const [athlete] = await db
      .select({ id: athletes.id })
      .from(athletes)
      .where(and(eq(athletes.id, athleteId), eq(athletes.organizationId, organizationId), eq(athletes.active, true)))
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
