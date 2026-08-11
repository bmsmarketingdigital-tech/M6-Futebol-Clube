import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { communications } from "../../../../db/schema";
import { getApiContext } from "../../api-auth";
import { buildRecipientSnapshot, normalizeCommunication, type CommunicationPayload } from "../communication-utils";

export const dynamic = "force-dynamic";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getApiContext(request);
  if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  const normalized = normalizeCommunication((await request.json()) as CommunicationPayload);
  if ("error" in normalized) return Response.json({ error: normalized.error }, { status: 400 });
  const { id } = await params; const db = getDb();
  const [current] = await db.select({ status: communications.status, updatedAt: communications.updatedAt }).from(communications).where(and(eq(communications.id, id), eq(communications.organizationId, context.membership.organizationId))).limit(1);
  if (!current) return Response.json({ error: "Comunicado não encontrado." }, { status: 404 });
  if (current.status === "sent") return Response.json({ error: "Comunicados enviados não podem ser alterados." }, { status: 409 });
  const organizationId = context.membership.organizationId;
  let recipients;
  try { recipients = await buildRecipientSnapshot(organizationId, normalized.value.audienceType, normalized.value.teamId); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Destinatários inválidos." }, { status: 404 }); }
  const previousUpdatedAt = Math.floor(current.updatedAt.getTime() / 1000);
  const now = Math.max(Math.floor(Date.now() / 1000), previousUpdatedAt + 1); const d1 = getD1();
  const statements = [
    d1.prepare(`UPDATE communications SET title=?,message=?,audience_type=?,team_id=?,priority=?,status=?,scheduled_at=?,sent_at=?,updated_at=?
      WHERE id=? AND organization_id=? AND status<>'sent' AND updated_at=?`).bind(normalized.value.title,normalized.value.message,normalized.value.audienceType,normalized.value.teamId,normalized.value.priority,normalized.value.status,normalized.value.scheduledAt,normalized.value.status === "sent" ? now : null,now,id,organizationId,previousUpdatedAt),
    d1.prepare("DELETE FROM communication_recipients WHERE communication_id=? AND EXISTS(SELECT 1 FROM communications WHERE id=? AND organization_id=? AND updated_at=?)").bind(id,id,organizationId,now),
  ];
  for (const recipient of recipients) statements.push(d1.prepare(`INSERT INTO communication_recipients
    (id,communication_id,athlete_id,guardian_name,guardian_email,guardian_phone)
    SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM communications WHERE id=? AND organization_id=? AND updated_at=?)`).bind(recipient.id,id,recipient.athleteId,recipient.guardianName,recipient.guardianEmail,recipient.guardianPhone,id,organizationId,now));
  const results = await d1.batch(statements);
  if ((results[0].meta.changes ?? 0) !== 1) return Response.json({ error: "O comunicado foi alterado por outra operação." }, { status: 409 });
  return Response.json({ updated: true, recipientCount: recipients.length });
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getApiContext(request);
  if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  const { id } = await params;
  const [cancelled] = await getDb().update(communications).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(communications.id, id), eq(communications.organizationId, context.membership.organizationId))).returning({ id: communications.id });
  return cancelled ? Response.json({ cancelled: true }) : Response.json({ error: "Comunicado não encontrado." }, { status: 404 });
}
