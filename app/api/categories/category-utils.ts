import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { getPostgresClient, postgresConfigured } from "../../../db/postgres";
import { sportsCategories } from "../../../db/schema";

export const DEFAULT_CATEGORIES = [
  "Sub-7",
  "Sub-9",
  "Sub-11",
  "Sub-13",
  "Sub-15",
  "Sub-17",
] as const;

export async function listCategories(organizationId: string) {
  if (postgresConfigured()) {
    const sql = getPostgresClient();
    let rows = await sql<{
      id: string;
      name: string;
      sort_order: number;
      active: number | boolean;
      organization_id: string;
    }[]>`
      SELECT id, name, sort_order, active, organization_id
      FROM sports_categories
      WHERE organization_id = ${organizationId} AND active = 1
      ORDER BY sort_order ASC, name ASC
    `;

    if (rows.length === 0) {
      const now = Date.now();
      await sql.begin(async (transaction) => {
        for (const [index, name] of DEFAULT_CATEGORIES.entries()) {
          await transaction`
            INSERT INTO sports_categories (id, organization_id, name, sort_order, active, created_at, updated_at)
            VALUES (${crypto.randomUUID()}, ${organizationId}, ${name}, ${index * 10}, 1, ${now}, ${now})
            ON CONFLICT DO NOTHING
          `;
        }
      });
      rows = await sql`
        SELECT id, name, sort_order, active, organization_id
        FROM sports_categories
        WHERE organization_id = ${organizationId} AND active = 1
        ORDER BY sort_order ASC, name ASC
      `;
    }

    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      sortOrder: row.sort_order,
      active: Boolean(row.active),
    }));
  }

  const db = getDb();
  let rows = await db
    .select()
    .from(sportsCategories)
    .where(
      and(
        eq(sportsCategories.organizationId, organizationId),
        eq(sportsCategories.active, true),
      ),
    )
    .orderBy(asc(sportsCategories.sortOrder), asc(sportsCategories.name));

  if (rows.length === 0) {
    const now = new Date();
    await db
      .insert(sportsCategories)
      .values(
        DEFAULT_CATEGORIES.map((name, index) => ({
          id: crypto.randomUUID(),
          organizationId,
          name,
          sortOrder: index * 10,
          active: true,
          createdAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoNothing();

    rows = await db
      .select()
      .from(sportsCategories)
      .where(
        and(
          eq(sportsCategories.organizationId, organizationId),
          eq(sportsCategories.active, true),
        ),
      )
      .orderBy(asc(sportsCategories.sortOrder), asc(sportsCategories.name));
  }

  return rows;
}

export async function isValidCategory(
  organizationId: string,
  categoryName: string,
) {
  const categories = await listCategories(organizationId);
  return categories.some(
    (category) =>
      category.name.localeCompare(categoryName, "pt-BR", {
        sensitivity: "accent",
      }) === 0,
  );
}

export function normalizeCategoryName(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, 32)
    : "";
}
