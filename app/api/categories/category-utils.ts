import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
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
