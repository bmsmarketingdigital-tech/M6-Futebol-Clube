import { and, count, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { getPostgresClient, postgresConfigured } from "../../../../db/postgres";
import {
  athletes,
  sportsCategories,
  teams,
} from "../../../../db/schema";
import { getApiContext } from "../../api-auth";
import { normalizeCategoryName } from "../category-utils";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getApiContext(request);
  if (!context) {
    return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  }

  const { id } = await params;
  const payload = (await request.json()) as { name?: string };
  const name = normalizeCategoryName(payload.name);
  if (name.length < 2) {
    return Response.json(
      { error: "Informe um nome de categoria com pelo menos 2 caracteres." },
      { status: 400 },
    );
  }

  const organizationId = context.membership.organizationId;
  if (postgresConfigured()) {
    const sql = getPostgresClient();
    const [category] = await sql<{ id: string; name: string; sort_order: number }[]>`
      SELECT id, name, sort_order
      FROM sports_categories
      WHERE id = ${id} AND organization_id = ${organizationId} AND active = 1
      LIMIT 1
    `;
    if (!category) {
      return Response.json({ error: "Categoria não encontrada." }, { status: 404 });
    }

    const [duplicate] = await sql<{ id: string }[]>`
      SELECT id
      FROM sports_categories
      WHERE organization_id = ${organizationId} AND name = ${name} AND active = 1
      LIMIT 1
    `;
    if (duplicate && duplicate.id !== id) {
      return Response.json(
        { error: "Já existe uma categoria com esse nome." },
        { status: 409 },
      );
    }

    const now = Date.now();
    try {
      await sql.begin(async (transaction) => {
        await transaction`
          UPDATE sports_categories
          SET name = ${name}, updated_at = ${now}
          WHERE id = ${id} AND organization_id = ${organizationId}
        `;
        await transaction`
          UPDATE athletes
          SET category = ${name}, updated_at = ${now}
          WHERE organization_id = ${organizationId} AND category = ${category.name}
        `;
        await transaction`
          UPDATE teams
          SET category = ${name}
          WHERE organization_id = ${organizationId} AND category = ${category.name}
        `;
      });
    } catch {
      return Response.json(
        { error: "Já existe uma categoria com esse nome." },
        { status: 409 },
      );
    }

    return Response.json({
      category: { id, name, sortOrder: category.sort_order },
    });
  }

  const db = getDb();
  const [category] = await db
    .select()
    .from(sportsCategories)
    .where(
      and(
        eq(sportsCategories.id, id),
        eq(sportsCategories.organizationId, organizationId),
        eq(sportsCategories.active, true),
      ),
    )
    .limit(1);

  if (!category) {
    return Response.json({ error: "Categoria não encontrada." }, { status: 404 });
  }

  const [duplicate] = await db
    .select({ id: sportsCategories.id })
    .from(sportsCategories)
    .where(
      and(
        eq(sportsCategories.organizationId, organizationId),
        eq(sportsCategories.name, name),
        eq(sportsCategories.active, true),
      ),
    )
    .limit(1);

  if (duplicate && duplicate.id !== id) {
    return Response.json(
      { error: "Já existe uma categoria com esse nome." },
      { status: 409 },
    );
  }

  const now = Date.now();
  try {
    await getD1().batch([
      getD1()
        .prepare(
          "UPDATE sports_categories SET name = ?, updated_at = ? WHERE id = ? AND organization_id = ?",
        )
        .bind(name, now, id, organizationId),
      getD1()
        .prepare(
          "UPDATE athletes SET category = ?, updated_at = ? WHERE organization_id = ? AND category = ?",
        )
        .bind(name, now, organizationId, category.name),
      getD1()
        .prepare(
          "UPDATE teams SET category = ? WHERE organization_id = ? AND category = ?",
        )
        .bind(name, organizationId, category.name),
    ]);
  } catch {
    return Response.json(
      { error: "Já existe uma categoria com esse nome." },
      { status: 409 },
    );
  }

  return Response.json({
    category: { id, name, sortOrder: category.sortOrder },
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getApiContext(request);
  if (!context) {
    return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  }

  const { id } = await params;
  const organizationId = context.membership.organizationId;
  if (postgresConfigured()) {
    const sql = getPostgresClient();
    const [category] = await sql<{ id: string; name: string }[]>`
      SELECT id, name
      FROM sports_categories
      WHERE id = ${id} AND organization_id = ${organizationId} AND active = 1
      LIMIT 1
    `;
    if (!category) {
      return Response.json({ error: "Categoria não encontrada." }, { status: 404 });
    }

    const [[athleteInUse], [teamInUse]] = await Promise.all([
      sql<{ id: string }[]>`
        SELECT id FROM athletes
        WHERE organization_id = ${organizationId} AND category = ${category.name} AND active = 1
        LIMIT 1
      `,
      sql<{ id: string }[]>`
        SELECT id FROM teams
        WHERE organization_id = ${organizationId} AND category = ${category.name} AND active = 1
        LIMIT 1
      `,
    ]);
    if (athleteInUse || teamInUse) {
      return Response.json(
        {
          error:
            "Essa categoria está em uso. Edite os atletas e as turmas antes de excluí-la.",
        },
        { status: 409 },
      );
    }

    const [categoryTotal] = await sql<{ value: number }[]>`
      SELECT COUNT(*)::int AS value
      FROM sports_categories
      WHERE organization_id = ${organizationId} AND active = 1
    `;
    if ((categoryTotal?.value ?? 0) <= 1) {
      return Response.json(
        { error: "Mantenha pelo menos uma categoria cadastrada." },
        { status: 409 },
      );
    }

    const result = await sql`
      DELETE FROM sports_categories
      WHERE id = ${id} AND organization_id = ${organizationId} AND active = 1
        AND NOT EXISTS (
          SELECT 1 FROM athletes a
          WHERE a.organization_id = ${organizationId} AND a.category = sports_categories.name AND a.active = 1
        )
        AND NOT EXISTS (
          SELECT 1 FROM teams t
          WHERE t.organization_id = ${organizationId} AND t.category = sports_categories.name AND t.active = 1
        )
        AND (
          SELECT COUNT(*) FROM sports_categories sc2
          WHERE sc2.organization_id = ${organizationId} AND sc2.active = 1
        ) > 1
    `;

    if (result.count !== 1) {
      return Response.json(
        {
          error:
            "Essa categoria está em uso ou é a única cadastrada. Atualize os vínculos e tente novamente.",
        },
        { status: 409 },
      );
    }

    return Response.json({ deleted: true, id });
  }

  const db = getDb();
  const [category] = await db
    .select()
    .from(sportsCategories)
    .where(
      and(
        eq(sportsCategories.id, id),
        eq(sportsCategories.organizationId, organizationId),
        eq(sportsCategories.active, true),
      ),
    )
    .limit(1);

  if (!category) {
    return Response.json({ error: "Categoria não encontrada." }, { status: 404 });
  }

  const [[athleteInUse], [teamInUse]] = await Promise.all([
    db
      .select({ id: athletes.id })
      .from(athletes)
      .where(
        and(
          eq(athletes.organizationId, organizationId),
          eq(athletes.category, category.name),
          eq(athletes.active, true),
        ),
      )
      .limit(1),
    db
      .select({ id: teams.id })
      .from(teams)
      .where(
        and(
          eq(teams.organizationId, organizationId),
          eq(teams.category, category.name),
          eq(teams.active, true),
        ),
      )
      .limit(1),
  ]);

  if (athleteInUse || teamInUse) {
    return Response.json(
      {
        error:
          "Essa categoria está em uso. Edite os atletas e as turmas antes de excluí-la.",
      },
      { status: 409 },
    );
  }

  const [categoryTotal] = await db
    .select({ value: count() })
    .from(sportsCategories)
    .where(
      and(
        eq(sportsCategories.organizationId, organizationId),
        eq(sportsCategories.active, true),
      ),
    );

  if ((categoryTotal?.value ?? 0) <= 1) {
    return Response.json(
      { error: "Mantenha pelo menos uma categoria cadastrada." },
      { status: 409 },
    );
  }

  // The reads above are best-effort for a friendly error message only. The DELETE
  // itself re-checks "not in use" and "not the last category" atomically, so a
  // concurrent athlete/team assignment between the check and the write can never
  // leave an athlete/team pointing at a category that no longer exists (P0-CAT-001).
  const d1 = getD1();
  const result = await d1
    .prepare(
      `DELETE FROM sports_categories
       WHERE id = ? AND organization_id = ? AND active = 1
         AND NOT EXISTS (
           SELECT 1 FROM athletes a
           WHERE a.organization_id = ? AND a.category = sports_categories.name AND a.active = 1
         )
         AND NOT EXISTS (
           SELECT 1 FROM teams t
           WHERE t.organization_id = ? AND t.category = sports_categories.name AND t.active = 1
         )
         AND (
           SELECT COUNT(*) FROM sports_categories sc2
           WHERE sc2.organization_id = ? AND sc2.active = 1
         ) > 1`,
    )
    .bind(id, organizationId, organizationId, organizationId, organizationId)
    .run();

  if ((result.meta.changes ?? 0) !== 1) {
    return Response.json(
      {
        error:
          "Essa categoria está em uso ou é a única cadastrada. Atualize os vínculos e tente novamente.",
      },
      { status: 409 },
    );
  }

  return Response.json({ deleted: true, id });
}
