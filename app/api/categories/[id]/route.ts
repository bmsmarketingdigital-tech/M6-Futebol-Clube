import { and, count, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
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

  await db
    .delete(sportsCategories)
    .where(
      and(
        eq(sportsCategories.id, id),
        eq(sportsCategories.organizationId, organizationId),
      ),
    );

  return Response.json({ deleted: true, id });
}
