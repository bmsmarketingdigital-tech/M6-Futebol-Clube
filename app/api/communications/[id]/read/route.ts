import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { getPostgresClient, postgresConfigured } from "../../../../../db/postgres";
import { communicationRecipients, communications } from "../../../../../db/schema";
import { getApiContext } from "../../../api-auth";

export const dynamic = "force-dynamic";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getApiContext(request);
    if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    const { id } = await params; const payload = (await request.json()) as { recipientId?: string; read?: boolean };
    if (!payload.recipientId) return Response.json({ error: "Destinatário inválido." }, { status: 400 });
    if (postgresConfigured()) {
      const sql = getPostgresClient();
      const updated = await sql<{ id: string }[]>`
        UPDATE communication_recipients r
        SET read_at = ${payload.read === false ? null : Math.floor(Date.now() / 1000)}
        FROM communications c
        WHERE r.id = ${payload.recipientId} AND r.communication_id = ${id}
          AND c.id = r.communication_id AND c.organization_id = ${context.membership.organizationId}
        RETURNING r.id
      `;
      return updated[0] ? Response.json({ updated: true }) : Response.json({ error: "Destinatário não encontrado." }, { status: 404 });
    }
  const [message] = await getDb().select({ id: communications.id }).from(communications).where(and(eq(communications.id, id), eq(communications.organizationId, context.membership.organizationId))).limit(1);
  if (!message) return Response.json({ error: "Comunicado não encontrado." }, { status: 404 });
  const [updated] = await getDb().update(communicationRecipients).set({ readAt: payload.read === false ? null : new Date() }).where(and(eq(communicationRecipients.id, payload.recipientId), eq(communicationRecipients.communicationId, id))).returning({ id: communicationRecipients.id });
    return updated ? Response.json({ updated: true }) : Response.json({ error: "Destinatário não encontrado." }, { status: 404 });
  } catch (error) {
    console.error("Failed to update communication recipient", error);
    return Response.json({ error: "Não foi possível atualizar a leitura." }, { status: 500 });
  }
}
