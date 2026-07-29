import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { communicationRecipients, communications } from "../../../../db/schema";
import { getApiContext } from "../../api-auth";
import { normalizeCommunication, snapshotRecipients, type CommunicationPayload } from "../communication-utils";

export const dynamic = "force-dynamic";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getApiContext(request);
  if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  const normalized = normalizeCommunication((await request.json()) as CommunicationPayload);
  if ("error" in normalized) return Response.json({ error: normalized.error }, { status: 400 });
  const { id } = await params; const db = getDb();
  const [current] = await db.select({ status: communications.status }).from(communications).where(and(eq(communications.id, id), eq(communications.organizationId, context.membership.organizationId))).limit(1);
  if (!current) return Response.json({ error: "Comunicado não encontrado." }, { status: 404 });
  if (current.status === "sent") return Response.json({ error: "Comunicados enviados não podem ser alterados." }, { status: 409 });
  const now = new Date();
  await db.update(communications).set({ ...normalized.value, sentAt: normalized.value.status === "sent" ? now : null, updatedAt: now }).where(eq(communications.id, id));
  await db.delete(communicationRecipients).where(eq(communicationRecipients.communicationId, id));
  const recipientCount = await snapshotRecipients(context.membership.organizationId, id, normalized.value.audienceType, normalized.value.teamId);
  return Response.json({ updated: true, recipientCount });
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getApiContext(request);
  if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  const { id } = await params;
  const [cancelled] = await getDb().update(communications).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(communications.id, id), eq(communications.organizationId, context.membership.organizationId))).returning({ id: communications.id });
  return cancelled ? Response.json({ cancelled: true }) : Response.json({ error: "Comunicado não encontrado." }, { status: 404 });
}
