import { and, asc, eq, inArray } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import { getPostgresClient, postgresConfigured } from "../../../db/postgres";
import { athletes, teamAthletes, teams } from "../../../db/schema";
import { getApiContext } from "../api-auth";
import { isValidCategory } from "../categories/category-utils";
import { normalizeTeamPayload, teamToDto, type TeamPayload } from "./team-utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    }

    if (postgresConfigured()) {
      const sql = getPostgresClient();
      const rows = await sql<{
        id: string;
        name: string;
        category: string;
        coach_name: string | null;
        schedule_days: string;
        start_time: string;
        end_time: string;
        place: string;
        capacity: number;
      }[]>`
        SELECT id, name, category, coach_name, schedule_days,
               start_time, end_time, place, capacity
        FROM teams
        WHERE organization_id = ${context.membership.organizationId}
          AND active = 1
        ORDER BY start_time ASC, category ASC
      `;

      const enrollments =
        rows.length === 0
          ? []
          : await sql<{ team_id: string; athlete_id: string }[]>`
              SELECT ta.team_id, ta.athlete_id
              FROM team_athletes ta
              INNER JOIN athletes a
                ON a.id = ta.athlete_id
               AND a.organization_id = ta.organization_id
               AND a.active = 1
              WHERE ta.organization_id = ${context.membership.organizationId}
                AND ta.active = 1
                AND ta.team_id = ANY(${rows.map((team) => team.id)})
            `;

      const athleteIdsByTeam = new Map<string, string[]>();
      for (const enrollment of enrollments) {
        const current = athleteIdsByTeam.get(enrollment.team_id) ?? [];
        current.push(enrollment.athlete_id);
        athleteIdsByTeam.set(enrollment.team_id, current);
      }

      return Response.json({
        teams: rows.map((team) =>
          teamToDto(team, athleteIdsByTeam.get(team.id) ?? []),
        ),
      });
    }

    const db = getDb();
    const rows = await db
      .select()
      .from(teams)
      .where(
        and(
          eq(teams.organizationId, context.membership.organizationId),
          eq(teams.active, true),
        ),
      )
      .orderBy(asc(teams.startTime), asc(teams.category));

    const enrollments =
      rows.length === 0
        ? []
        : await db
            .select({
              teamId: teamAthletes.teamId,
              athleteId: teamAthletes.athleteId,
            })
            .from(teamAthletes)
            .innerJoin(
              athletes,
              and(
                eq(athletes.id, teamAthletes.athleteId),
                eq(athletes.organizationId, teamAthletes.organizationId),
                eq(athletes.active, true),
              ),
            )
            .where(
              and(
                eq(
                  teamAthletes.organizationId,
                  context.membership.organizationId,
                ),
                eq(teamAthletes.active, true),
                inArray(
                  teamAthletes.teamId,
                  rows.map((team) => team.id),
                ),
              ),
            );

    const athleteIdsByTeam = new Map<string, string[]>();
    for (const enrollment of enrollments) {
      const current = athleteIdsByTeam.get(enrollment.teamId) ?? [];
      current.push(enrollment.athleteId);
      athleteIdsByTeam.set(enrollment.teamId, current);
    }

    return Response.json({
      teams: rows.map((team) =>
        teamToDto(team, athleteIdsByTeam.get(team.id) ?? []),
      ),
    });
  } catch (error) {
    console.error("Failed to list teams", error);
    return Response.json(
      { error: "Não foi possível carregar as turmas." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    }

    const normalized = normalizeTeamPayload(
      (await request.json()) as TeamPayload,
    );
    if ("error" in normalized) {
      return Response.json({ error: normalized.error }, { status: 400 });
    }
    const value = normalized.value;
    if (
      !(await isValidCategory(
        context.membership.organizationId,
        value.category,
      ))
    ) {
      return Response.json(
        { error: "Selecione uma categoria válida." },
        { status: 400 },
      );
    }
    const organizationId = context.membership.organizationId;
    if (postgresConfigured()) {
      const sql = getPostgresClient();
      if (value.athleteIds.length > 0) {
        const validAthletes = await sql<{ id: string; category: string }[]>`
          SELECT id, category
          FROM athletes
          WHERE organization_id = ${organizationId}
            AND active = 1
            AND id = ANY(${value.athleteIds})
        `;
        if (validAthletes.length !== value.athleteIds.length) {
          return Response.json(
            { error: "Um ou mais atletas selecionados nÃ£o sÃ£o vÃ¡lidos." },
            { status: 400 },
          );
        }
        if (validAthletes.some((athlete) => athlete.category !== value.category)) {
          return Response.json(
            {
              error:
                "Um ou mais atletas selecionados sÃ£o de categoria diferente da turma.",
            },
            { status: 409 },
          );
        }
      }

      const teamId = crypto.randomUUID();
      const createdAt = Math.floor(Date.now() / 1000);
      const created = await sql.begin(async (transaction) => {
        const [inserted] = await transaction<{
          id: string;
          name: string;
          category: string;
          coach_name: string | null;
          schedule_days: string;
          start_time: string;
          end_time: string;
          place: string;
          capacity: number;
        }[]>`
          INSERT INTO teams (
            id, organization_id, name, category, coach_name, schedule_days,
            start_time, end_time, place, capacity, active, created_at
          )
          VALUES (
            ${teamId}, ${organizationId}, ${value.name}, ${value.category},
            ${value.coachName}, ${JSON.stringify(value.scheduleDays)},
            ${value.startTime}, ${value.endTime}, ${value.place},
            ${value.capacity}, 1, ${createdAt}
          )
          RETURNING id, name, category, coach_name, schedule_days,
                    start_time, end_time, place, capacity
        `;

        for (const athleteId of value.athleteIds) {
          await transaction`
            INSERT INTO team_athletes
              (organization_id, team_id, athlete_id, active, enrolled_at)
            VALUES (${organizationId}, ${teamId}, ${athleteId}, 1, ${createdAt})
          `;
        }

        return inserted;
      });

      return Response.json(
        { team: teamToDto(created, value.athleteIds) },
        { status: 201 },
      );
    }

    const db = getDb();

    if (value.athleteIds.length > 0) {
      const validAthletes = await db
        .select({ id: athletes.id })
        .from(athletes)
        .where(
          and(
            eq(athletes.organizationId, context.membership.organizationId),
            eq(athletes.active, true),
            inArray(athletes.id, value.athleteIds),
          ),
        );
      if (validAthletes.length !== value.athleteIds.length) {
        return Response.json(
          { error: "Um ou mais atletas selecionados não são válidos." },
          { status: 400 },
        );
      }
    }

    const teamId = crypto.randomUUID();
    const now = new Date();
    const createdAt = Math.floor(now.getTime() / 1000);
    const d1 = getD1();
    const statements = [
      d1
        .prepare(
          `INSERT INTO teams
            (id, organization_id, name, category, coach_name, schedule_days,
             start_time, end_time, place, capacity, active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        )
        .bind(
          teamId,
          organizationId,
          value.name,
          value.category,
          value.coachName,
          JSON.stringify(value.scheduleDays),
          value.startTime,
          value.endTime,
          value.place,
          value.capacity,
          createdAt,
        ),
      ...value.athleteIds.map((athleteId) =>
        d1
          .prepare(
            `INSERT INTO team_athletes
              (organization_id, team_id, athlete_id, active, enrolled_at)
             VALUES (?, ?, ?, 1, ?)`,
          )
          .bind(organizationId, teamId, athleteId, createdAt),
      ),
    ];
    await d1.batch(statements);

    const [created] = await db
      .select()
      .from(teams)
      .where(and(eq(teams.id, teamId), eq(teams.organizationId, organizationId)))
      .limit(1);
    if (!created) throw new Error("A turma criada não pôde ser carregada.");

    return Response.json(
      { team: teamToDto(created, value.athleteIds) },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to create team", error);
    return Response.json(
      { error: "Não foi possível criar a turma." },
      { status: 500 },
    );
  }
}
