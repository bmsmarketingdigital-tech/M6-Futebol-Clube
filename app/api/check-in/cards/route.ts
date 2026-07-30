import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../db";
import { athletes } from "../../../../db/schema";
import { getApiContext } from "../../api-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json(
        { error: "Faça login para acessar os QR Codes." },
        { status: 401 },
      );
    }

    const db = getDb();
    const organizationId = context.membership.organizationId;
    const withoutToken = await db
      .select({ id: athletes.id })
      .from(athletes)
      .where(
        and(
          eq(athletes.organizationId, organizationId),
          eq(athletes.active, true),
          isNull(athletes.qrToken),
        ),
      );

    for (const athlete of withoutToken) {
      await db
        .update(athletes)
        .set({ qrToken: crypto.randomUUID(), updatedAt: new Date() })
        .where(
          and(
            eq(athletes.id, athlete.id),
            eq(athletes.organizationId, organizationId),
          ),
        );
    }

    const rows = await db
      .select({
        id: athletes.id,
        name: athletes.fullName,
        category: athletes.category,
        qrToken: athletes.qrToken,
      })
      .from(athletes)
      .where(
        and(
          eq(athletes.organizationId, organizationId),
          eq(athletes.active, true),
        ),
      )
      .orderBy(asc(athletes.fullName));

    return Response.json({
      cards: rows
        .filter((athlete) => Boolean(athlete.qrToken))
        .map((athlete) => ({
          id: athlete.id,
          name: athlete.name,
          category: athlete.category,
          value: `BF1:${athlete.qrToken}`,
        })),
    });
  } catch (error) {
    console.error("Failed to load QR cards", error);
    return Response.json(
      { error: "Não foi possível gerar os QR Codes agora." },
      { status: 500 },
    );
  }
}
