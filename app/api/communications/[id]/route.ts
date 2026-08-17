import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { getPostgresClient, postgresConfigured } from "../../../../db/postgres";
import { communications } from "../../../../db/schema";
import { getApiContext } from "../../api-auth";
import { buildRecipientSnapshot, normalizeCommunication, type CommunicationPayload } from "../communication-utils";

export const dynamic = "force-dynamic";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getApiContext(request);
    if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    const normalized = normalizeCommunication((await request.json()) as CommunicationPayload);
    if ("error" in normalized) return Response.json({ error: normalized.error }, { status: 400 });
    const { id } = await params;
    const organizationId = context.membership.organizationId;
    if (postgresConfigured()) {
      const sql = getPostgresClient();
      const currentRows = await sql<{ status: string; updated_at: number }[]>`
        SELECT status, updated_at FROM communications
        WHERE id = ${id} AND organization_id = ${organizationId} LIMIT 1
      `;
      const current = currentRows[0];
      if (!current) return Response.json({ error: "Comunicado não encontrado." }, { status: 404 });
      if (current.status === "sent") return Response.json({ error: "Comunicados enviados não podem ser alterados." }, { status: 409 });
      let recipients;
      try { recipients = await buildRecipientSnapshot(organizationId, normalized.value.audienceType, normalized.value.teamId); }
      catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Destinatários inválidos." }, { status: 404 }); }
      const previousUpdatedAt = Number(current.updated_at);
      const now = Math.max(Math.floor(Date.now() / 1000), previousUpdatedAt + 1);
      const changed = await sql.begin(async (transaction) => {
        const updated = await transaction<{ id: string }[]>`
          UPDATE communications SET title = ${normalized.value.title}, message = ${normalized.value.message},
            audience_type = ${normalized.value.audienceType}, team_id = ${normalized.value.teamId},
            priority = ${normalized.value.priority}, status = ${normalized.value.status},
            scheduled_at = ${normalized.value.scheduledAt}, sent_at = ${normalized.value.status === "sent" ? now : null},
            updated_at = ${now}
          WHERE id = ${id} AND organization_id = ${organizationId}
            AND status <> 'sent' AND updated_at = ${previousUpdatedAt}
          RETURNING id
        `;
        if (!updated[0]) return false;
        await transaction`DELETE FROM communication_recipients WHERE communication_id = ${id}`;
        for (const recipient of recipients) {
          await transaction`
            INSERT INTO communication_recipients
              (id, communication_id, athlete_id, guardian_name, guardian_email, guardian_phone)
            VALUES (${recipient.id}, ${id}, ${recipient.athleteId}, ${recipient.guardianName},
                    ${recipient.guardianEmail}, ${recipient.guardianPhone})
          `;
        }
        return true;
      });
      return changed
        ? Response.json({ updated: true, recipientCount: recipients.length })
        : Response.json({ error: "O comunicado foi alterado por outra operação." }, { status: 409 });
    }
    const db = getDb();
  const [current] = await db.select({ status: communications.status, updatedAt: communications.updatedAt }).from(communications).where(and(eq(communications.id, id), eq(communications.organizationId, context.membership.organizationId))).limit(1);
  if (!current) return Response.json({ error: "Comunicado não encontrado." }, { status: 404 });
  if (current.status === "sent") return Response.json({ error: "Comunicados enviados não podem ser alterados." }, { status: 409 });

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
  } catch (error) {
    console.error("Failed to update communication", error);
    return Response.json({ error: "Não foi possível atualizar o comunicado." }, { status: 500 });
  }
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getApiContext(request);
    if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    const { id } = await params;
    if (postgresConfigured()) {
      const cancelled = await getPostgresClient()<{ id: string }[]>`
        UPDATE communications SET status = 'cancelled', updated_at = ${Math.floor(Date.now() / 1000)}
        WHERE id = ${id} AND organization_id = ${context.membership.organizationId}
        RETURNING id
      `;
      return cancelled[0] ? Response.json({ cancelled: true }) : Response.json({ error: "Comunicado não encontrado." }, { status: 404 });
    }
    const [cancelled] = await getDb().update(communications).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(communications.id, id), eq(communications.organizationId, context.membership.organizationId))).returning({ id: communications.id });
    return cancelled ? Response.json({ cancelled: true }) : Response.json({ error: "Comunicado não encontrado." }, { status: 404 });
  } catch (error) {
    console.error("Failed to cancel communication", error);
    return Response.json({ error: "Não foi possível cancelar o comunicado." }, { status: 500 });
  }
}
