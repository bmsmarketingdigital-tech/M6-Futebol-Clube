import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { billingPlans } from "../../../../db/schema";
import { getApiContext } from "../../api-auth";
import { parsePlanPayload } from "../finance-utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getApiContext(request);
  if (!context) {
    return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  }
  const rows = await getDb()
    .select()
    .from(billingPlans)
    .where(
      and(
        eq(billingPlans.organizationId, context.membership.organizationId),
        eq(billingPlans.active, true),
      ),
    )
    .orderBy(asc(billingPlans.name));
  return Response.json({ plans: rows });
}

export async function POST(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    }
    const parsed = parsePlanPayload(await request.json());
    if ("error" in parsed) {
      return Response.json({ error: parsed.error }, { status: 400 });
    }
    const now = new Date();
    const [plan] = await getDb()
      .insert(billingPlans)
      .values({
        id: crypto.randomUUID(),
        organizationId: context.membership.organizationId,
        ...parsed.value,
        active: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return Response.json({ plan }, { status: 201 });
  } catch (error) {
    console.error("Failed to create billing plan", error);
    return Response.json(
      { error: "Não foi possível criar o plano." },
      { status: 500 },
    );
  }
}
