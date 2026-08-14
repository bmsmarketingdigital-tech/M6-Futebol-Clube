import { and, eq, inArray } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { getPostgresClient, postgresConfigured } from "../../../../db/postgres";
import { athletes, teamAthletes, teams } from "../../../../db/schema";
import { getApiContext } from "../../api-auth";
import { isValidCategory } from "../../categories/category-utils";
import {
  normalizeTeamPayload,
  teamToDto,
  type TeamPayload,
} from "../team-utils";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    }

    const { id } = await params;
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
      const [current] = await sql<{
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
        WHERE id = ${id}
          AND organization_id = ${organizationId}
          AND active = 1
        LIMIT 1
      `;
      if (!current) {
        return Response.json({ error: "Turma nÃ£o encontrada." }, { status: 404 });
      }

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

      const scheduleDays = JSON.stringify(value.scheduleDays);
      const now = Math.floor(Date.now() / 1000);
      const updated = await sql.begin(async (transaction) => {
        const [locked] = await transaction<{ id: string }[]>`
          SELECT id
          FROM teams
          WHERE id = ${id}
            AND organization_id = ${organizationId}
            AND active = 1
          FOR UPDATE
        `;
        if (!locked) return null;

        await transaction`
          UPDATE team_athletes
          SET active = 0
          WHERE team_id = ${id}
            AND organization_id = ${organizationId}
        `;

        for (const athleteId of value.athleteIds) {
          await transaction`
            INSERT INTO team_athletes
              (organization_id, team_id, athlete_id, active, enrolled_at)
            VALUES (${organizationId}, ${id}, ${athleteId}, 1, ${now})
            ON CONFLICT (team_id, athlete_id) DO UPDATE SET
              organization_id = EXCLUDED.organization_id,
              active = 1,
              enrolled_at = EXCLUDED.enrolled_at
          `;
        }

        const [row] = await transaction<{
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
          UPDATE teams
          SET name = ${value.name},
              category = ${value.category},
              coach_name = ${value.coachName},
              schedule_days = ${scheduleDays},
              start_time = ${value.startTime},
              end_time = ${value.endTime},
              place = ${value.place},
              capacity = ${value.capacity}
          WHERE id = ${id}
            AND organization_id = ${organizationId}
            AND active = 1
          RETURNING id, name, category, coach_name, schedule_days,
                    start_time, end_time, place, capacity
        `;
        return row;
      });

      if (!updated) {
        return Response.json({ error: "Turma nÃ£o encontrada." }, { status: 404 });
      }

      return Response.json({ team: teamToDto(updated, value.athleteIds) });
    }

    const db = getDb();
    const [current] = await db
      .select()
      .from(teams)
      .where(
        and(
          eq(teams.id, id),
          eq(teams.organizationId, organizationId),
          eq(teams.active, true),
        ),
      )
      .limit(1);
    if (!current) {
      return Response.json({ error: "Turma não encontrada." }, { status: 404 });
    }

    if (value.athleteIds.length > 0) {
      const validAthletes = await db
        .select({ id: athletes.id, category: athletes.category })
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
      if (validAthletes.some((athlete) => athlete.category !== value.category)) {
        return Response.json(
          {
            error:
              "Um ou mais atletas selecionados são de categoria diferente da turma.",
          },
          { status: 409 },
        );
      }
    }

    const activeEnrollments = await db
      .select({ athleteId: teamAthletes.athleteId })
      .from(teamAthletes)
      .where(
        and(
          eq(teamAthletes.teamId, id),
          eq(teamAthletes.organizationId, organizationId),
          eq(teamAthletes.active, true),
        ),
      );
    const previousAthleteIds = activeEnrollments.map((row) => row.athleteId);
    const marker = `__team_update__${crypto.randomUUID()}`;
    const previousMembershipPredicates = previousAthleteIds
      .map(
        () =>
          "AND EXISTS (SELECT 1 FROM team_athletes ta WHERE ta.team_id = ? AND ta.organization_id = ? AND ta.athlete_id = ? AND ta.active = 1)",
      )
      .join(" ");
    const acquireSql = `UPDATE teams SET name = ?
      WHERE id = ? AND organization_id = ? AND active = 1
        AND name = ? AND category = ? AND COALESCE(coach_name, '') = ?
        AND schedule_days = ? AND start_time = ? AND end_time = ?
        AND place = ? AND capacity = ?
        AND (SELECT COUNT(*) FROM team_athletes ta
             WHERE ta.team_id = ? AND ta.organization_id = ? AND ta.active = 1) = ?
        ${previousMembershipPredicates}`;
    const acquireBindings: unknown[] = [
      marker, id, organizationId, current.name, current.category,
      current.coachName ?? "", current.scheduleDays, current.startTime,
      current.endTime, current.place, current.capacity,
      id, organizationId, previousAthleteIds.length,
    ];
    for (const athleteId of previousAthleteIds) {
      acquireBindings.push(id, organizationId, athleteId);
    }

    const scheduleDays = JSON.stringify(value.scheduleDays);
    const now = Math.floor(Date.now() / 1000);
    const d1 = getD1();
    const statements = [
      d1.prepare(acquireSql).bind(...acquireBindings),
      d1
        .prepare(
          `UPDATE team_athletes SET active = 0
           WHERE team_id = ? AND organization_id = ?
             AND EXISTS (SELECT 1 FROM teams WHERE id = ? AND organization_id = ? AND name = ?)`,
        )
        .bind(id, organizationId, id, organizationId, marker),
      ...value.athleteIds.map((athleteId) =>
        d1
          .prepare(
            `INSERT INTO team_athletes
              (organization_id, team_id, athlete_id, active, enrolled_at)
             SELECT ?, ?, ?, 1, ?
             WHERE EXISTS (SELECT 1 FROM teams WHERE id = ? AND organization_id = ? AND name = ?)
             ON CONFLICT(team_id, athlete_id) DO UPDATE SET
               organization_id = excluded.organization_id,
               active = 1,
               enrolled_at = excluded.enrolled_at`,
          )
          .bind(organizationId, id, athleteId, now, id, organizationId, marker),
      ),
      d1
        .prepare(
          `UPDATE teams SET name = ?, category = ?, coach_name = ?, schedule_days = ?,
             start_time = ?, end_time = ?, place = ?, capacity = ?
           WHERE id = ? AND organization_id = ? AND name = ?`,
        )
        .bind(
          value.name, value.category, value.coachName, scheduleDays,
          value.startTime, value.endTime, value.place, value.capacity,
          id, organizationId, marker,
        ),
    ];
    const results = await d1.batch(statements);
    if ((results[0].meta.changes ?? 0) !== 1) {
      return Response.json(
        { error: "A turma foi alterada por outra operação." },
        { status: 409 },
      );
    }

    const [updated] = await db
      .select()
      .from(teams)
      .where(and(eq(teams.id, id), eq(teams.organizationId, organizationId)))
      .limit(1);
    if (!updated) throw new Error("A turma atualizada não pôde ser carregada.");
    return Response.json({ team: teamToDto(updated, value.athleteIds) });
  } catch (error) {
    console.error("Failed to update team", error);
    return Response.json(
      { error: "Não foi possível atualizar a turma." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    }

    const { id } = await params;
    const organizationId = context.membership.organizationId;
    if (postgresConfigured()) {
      const sql = getPostgresClient();
      const archived = await sql.begin(async (transaction) => {
        const [row] = await transaction<{ id: string }[]>`
          UPDATE teams
          SET active = 0
          WHERE id = ${id}
            AND organization_id = ${organizationId}
            AND active = 1
          RETURNING id
        `;
        if (!row) return null;
        await transaction`
          UPDATE team_athletes
          SET active = 0
          WHERE team_id = ${id}
            AND organization_id = ${organizationId}
        `;
        return row;
      });

      if (!archived) {
        return Response.json({ error: "Turma nÃ£o encontrada." }, { status: 404 });
      }

      return Response.json({ archived: true, id: archived.id });
    }

    const db = getDb();
    const [archived] = await db
      .update(teams)
      .set({ active: false })
      .where(
        and(
          eq(teams.id, id),
          eq(teams.organizationId, organizationId),
          eq(teams.active, true),
        ),
      )
      .returning({ id: teams.id });

    if (!archived) {
      return Response.json({ error: "Turma não encontrada." }, { status: 404 });
    }

    await db
      .update(teamAthletes)
      .set({ active: false })
      .where(
        and(
          eq(teamAthletes.teamId, id),
          eq(
            teamAthletes.organizationId,
            organizationId,
          ),
        ),
      );

    return Response.json({ archived: true, id: archived.id });
  } catch (error) {
    console.error("Failed to archive team", error);
    return Response.json(
      { error: "Não foi possível arquivar a turma." },
      { status: 500 },
    );
  }
}
