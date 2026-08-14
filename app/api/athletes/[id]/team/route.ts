import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../../db";
import { getPostgresClient, postgresConfigured } from "../../../../../db/postgres";
import { athletes, teamAthletes, teams } from "../../../../../db/schema";
import { getApiContext } from "../../../api-auth";

export const dynamic = "force-dynamic";

// Troca (ou remoção) da turma do atleta, em uma única operação atômica.
// - teamId === null: apenas desativa o vínculo ativo atual ("Sem turma").
// - teamId informado: valida organização/categoria/capacidade da turma nova
//   ANTES de escrever qualquer coisa; se a validação falhar, a turma atual
//   (se houver) permanece intacta — nunca deixamos o atleta "no meio do caminho".
// Histórico (attendance, check-ins, financeiro) nunca é tocado aqui.
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
    const payload = (await request.json()) as { teamId?: string | null };
    const requestedTeamId =
      typeof payload.teamId === "string" && payload.teamId.trim()
        ? payload.teamId.trim()
        : null;

    const organizationId = context.membership.organizationId;
    if (postgresConfigured()) {
      const sql = getPostgresClient();
      const [athlete] = await sql<{ id: string; category: string }[]>`
        SELECT id, category
        FROM athletes
        WHERE id = ${id}
          AND organization_id = ${organizationId}
          AND active = 1
        LIMIT 1
      `;
      if (!athlete) {
        return Response.json({ error: "Atleta nÃ£o encontrado." }, { status: 404 });
      }

      const [currentMembership] = await sql<{ team_id: string }[]>`
        SELECT team_id
        FROM team_athletes
        WHERE athlete_id = ${id}
          AND organization_id = ${organizationId}
          AND active = 1
        LIMIT 1
      `;
      const currentTeamId = currentMembership?.team_id ?? null;

      if (currentTeamId === requestedTeamId) {
        return Response.json({ teamId: currentTeamId });
      }

      if (!requestedTeamId) {
        await sql`
          UPDATE team_athletes
          SET active = 0
          WHERE athlete_id = ${id}
            AND organization_id = ${organizationId}
            AND active = 1
        `;
        return Response.json({ teamId: null });
      }

      const result = await sql.begin(async (transaction) => {
        const [targetTeam] = await transaction<{
          id: string;
          category: string;
          capacity: number;
        }[]>`
          SELECT id, category, capacity
          FROM teams
          WHERE id = ${requestedTeamId}
            AND organization_id = ${organizationId}
            AND active = 1
          FOR UPDATE
        `;
        if (!targetTeam) return { error: "NOT_FOUND" as const };
        if (targetTeam.category !== athlete.category) {
          return { error: "CATEGORY_MISMATCH" as const };
        }

        const [currentEnrollments] = await transaction<{ value: number }[]>`
          SELECT COUNT(*)::int AS value
          FROM team_athletes
          WHERE team_id = ${requestedTeamId}
            AND organization_id = ${organizationId}
            AND active = 1
        `;
        if ((currentEnrollments?.value ?? 0) >= targetTeam.capacity) {
          return { error: "CAPACITY" as const };
        }

        const now = Math.floor(Date.now() / 1000);
        if (currentTeamId) {
          await transaction`
            UPDATE team_athletes
            SET active = 0
            WHERE athlete_id = ${id}
              AND organization_id = ${organizationId}
              AND team_id = ${currentTeamId}
              AND active = 1
          `;
        }
        await transaction`
          INSERT INTO team_athletes
            (organization_id, team_id, athlete_id, active, enrolled_at)
          VALUES (${organizationId}, ${requestedTeamId}, ${id}, 1, ${now})
          ON CONFLICT (team_id, athlete_id) DO UPDATE SET
            organization_id = EXCLUDED.organization_id,
            active = 1,
            enrolled_at = EXCLUDED.enrolled_at
        `;
        return { teamId: requestedTeamId };
      });

      if ("error" in result) {
        if (result.error === "NOT_FOUND") {
          return Response.json({ error: "Turma nÃ£o encontrada." }, { status: 404 });
        }
        if (result.error === "CATEGORY_MISMATCH") {
          return Response.json(
            {
              error:
                "A turma selecionada Ã© de categoria diferente da categoria atual do atleta.",
            },
            { status: 409 },
          );
        }
        return Response.json(
          { error: "A turma selecionada atingiu a capacidade." },
          { status: 409 },
        );
      }

      return Response.json({ teamId: result.teamId });
    }

    const db = getDb();

    const [athlete] = await db
      .select({ id: athletes.id, category: athletes.category })
      .from(athletes)
      .where(
        and(
          eq(athletes.id, id),
          eq(athletes.organizationId, organizationId),
          eq(athletes.active, true),
        ),
      )
      .limit(1);
    if (!athlete) {
      return Response.json({ error: "Atleta não encontrado." }, { status: 404 });
    }

    const [currentMembership] = await db
      .select({ teamId: teamAthletes.teamId })
      .from(teamAthletes)
      .where(
        and(
          eq(teamAthletes.athleteId, id),
          eq(teamAthletes.organizationId, organizationId),
          eq(teamAthletes.active, true),
        ),
      )
      .limit(1);
    const currentTeamId = currentMembership?.teamId ?? null;

    if (currentTeamId === requestedTeamId) {
      return Response.json({ teamId: currentTeamId });
    }

    const d1 = getD1();
    const now = Math.floor(Date.now() / 1000);

    // Caso simples: "Sem turma" — apenas desativa o vínculo atual.
    if (!requestedTeamId) {
      await db
        .update(teamAthletes)
        .set({ active: false })
        .where(
          and(
            eq(teamAthletes.athleteId, id),
            eq(teamAthletes.organizationId, organizationId),
            eq(teamAthletes.active, true),
          ),
        );
      return Response.json({ teamId: null });
    }

    const [targetTeam] = await db
      .select()
      .from(teams)
      .where(
        and(
          eq(teams.id, requestedTeamId),
          eq(teams.organizationId, organizationId),
          eq(teams.active, true),
        ),
      )
      .limit(1);
    if (!targetTeam) {
      return Response.json({ error: "Turma não encontrada." }, { status: 404 });
    }
    if (targetTeam.category !== athlete.category) {
      return Response.json(
        {
          error:
            "A turma selecionada é de categoria diferente da categoria atual do atleta.",
        },
        { status: 409 },
      );
    }

    const currentEnrollments = await db
      .select({ athleteId: teamAthletes.athleteId })
      .from(teamAthletes)
      .where(
        and(
          eq(teamAthletes.teamId, requestedTeamId),
          eq(teamAthletes.organizationId, organizationId),
          eq(teamAthletes.active, true),
        ),
      );
    if (currentEnrollments.length >= targetTeam.capacity) {
      return Response.json(
        { error: "A turma selecionada atingiu a capacidade." },
        { status: 409 },
      );
    }

    // Marca (via nome temporário único) para travar a turma-alvo durante o
    // batch e detectar concorrência na última vaga — mesmo padrão usado em
    // app/api/teams/[id]/route.ts e app/api/athletes/route.ts.
    const marker = `__team_swap__${crypto.randomUUID()}`;
    const statements = [
      d1
        .prepare(
          `UPDATE teams SET name = ? WHERE id = ? AND organization_id = ?
             AND active = 1 AND name = ? AND category = ? AND capacity = ?
             AND (SELECT COUNT(*) FROM team_athletes ta WHERE ta.team_id = ?
                  AND ta.organization_id = ? AND ta.active = 1) = ?`,
        )
        .bind(
          marker, requestedTeamId, organizationId, targetTeam.name,
          targetTeam.category, targetTeam.capacity, requestedTeamId,
          organizationId, currentEnrollments.length,
        ),
      ...(currentTeamId
        ? [
            d1
              .prepare(
                `UPDATE team_athletes SET active = 0
                 WHERE athlete_id = ? AND organization_id = ? AND team_id = ? AND active = 1
                   AND EXISTS (SELECT 1 FROM teams WHERE id = ? AND organization_id = ? AND name = ?)`,
              )
              .bind(id, organizationId, currentTeamId, requestedTeamId, organizationId, marker),
          ]
        : []),
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
        .bind(organizationId, requestedTeamId, id, now, requestedTeamId, organizationId, marker),
      d1
        .prepare("UPDATE teams SET name = ? WHERE id = ? AND organization_id = ? AND name = ?")
        .bind(targetTeam.name, requestedTeamId, organizationId, marker),
    ];

    const results = await d1.batch(statements);
    if ((results[0].meta.changes ?? 0) !== 1) {
      return Response.json(
        { error: "A turma foi alterada por outra operação. Tente novamente." },
        { status: 409 },
      );
    }

    return Response.json({ teamId: requestedTeamId });
  } catch (error) {
    console.error("Failed to swap athlete team", error);
    return Response.json(
      { error: "Não foi possível atualizar a turma do atleta agora." },
      { status: 500 },
    );
  }
}
