import { eq, max } from "drizzle-orm";
import { getDb } from "../../../db";
import { sportsCategories } from "../../../db/schema";
import { getApiContext } from "../api-auth";
import {
  listCategories,
  normalizeCategoryName,
} from "./category-utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getApiContext(request);
  if (!context) {
    return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  }

  const categories = await listCategories(context.membership.organizationId);
  return Response.json({
    categories: categories.map(({ id, name, sortOrder }) => ({
      id,
      name,
      sortOrder,
    })),
  });
}

export async function POST(request: Request) {
  const context = await getApiContext(request);
  if (!context) {
    return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  }

  const payload = (await request.json()) as { name?: string };
  const name = normalizeCategoryName(payload.name);
  if (name.length < 2) {
    return Response.json(
      { error: "Informe um nome de categoria com pelo menos 2 caracteres." },
      { status: 400 },
    );
  }

  const db = getDb();
  const [lastOrder] = await db
    .select({ value: max(sportsCategories.sortOrder) })
    .from(sportsCategories)
    .where(
      eq(
        sportsCategories.organizationId,
        context.membership.organizationId,
      ),
    );
  const now = new Date();

  try {
    const [created] = await db
      .insert(sportsCategories)
      .values({
        id: crypto.randomUUID(),
        organizationId: context.membership.organizationId,
        name,
        sortOrder: (lastOrder?.value ?? 0) + 10,
        active: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return Response.json(
      {
        category: {
          id: created.id,
          name: created.name,
          sortOrder: created.sortOrder,
        },
      },
      { status: 201 },
    );
  } catch {
    return Response.json(
      { error: "Já existe uma categoria com esse nome." },
      { status: 409 },
    );
  }
}
