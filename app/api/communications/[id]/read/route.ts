import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { communicationRecipients, communications } from "../../../../../db/schema";
import { getApiContext } from "../../../api-auth";

export const dynamic = "force-dynamic";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getApiContext(request);
  if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  const { id } = await params; const payload = (await request.json()) as { recipientId?: string; read?: boolean };
  if (!payload.recipientId) return Response.json({ error: "Destinatário inválido." }, { status: 400 });
  const [message] = await getDb().select({ id: communications.id }).from(communications).where(and(eq(communications.id, id), eq(communications.organizationId, context.membership.organizationId))).limit(1);
  if (!message) return Response.json({ error: "Comunicado não encontrado." }, { status: 404 });
  const [updated] = await getDb().update(communicationRecipients).set({ readAt: payload.read === false ? null : new Date() }).where(and(eq(communicationRecipients.id, payload.recipientId), eq(communicationRecipients.communicationId, id))).returning({ id: communicationRecipients.id });
  return updated ? Response.json({ updated: true }) : Response.json({ error: "Destinatário não encontrado." }, { status: 404 });
}
