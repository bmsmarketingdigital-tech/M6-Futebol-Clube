import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
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

    const [updated] = await db
      .update(teams)
      .set({
        name: value.name,
        category: value.category,
        coachName: value.coachName,
        scheduleDays: JSON.stringify(value.scheduleDays),
        startTime: value.startTime,
        endTime: value.endTime,
        place: value.place,
        capacity: value.capacity,
      })
      .where(
        and(
          eq(teams.id, id),
          eq(teams.organizationId, context.membership.organizationId),
          eq(teams.active, true),
        ),
      )
      .returning();

    if (!updated) {
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
            context.membership.organizationId,
          ),
        ),
      );

    if (value.athleteIds.length > 0) {
      const now = new Date();
      for (const athleteId of value.athleteIds) {
        await db
          .insert(teamAthletes)
          .values({
            organizationId: context.membership.organizationId,
            teamId: id,
            athleteId,
            active: true,
            enrolledAt: now,
          })
          .onConflictDoUpdate({
            target: [teamAthletes.teamId, teamAthletes.athleteId],
            set: { active: true },
          });
      }
    }

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
    const db = getDb();
    const [archived] = await db
      .update(teams)
      .set({ active: false })
      .where(
        and(
          eq(teams.id, id),
          eq(teams.organizationId, context.membership.organizationId),
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
            context.membership.organizationId,
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
