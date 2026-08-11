import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import { athletes, communicationRecipients, communications, teams } from "../../../db/schema";
import { getApiContext } from "../api-auth";
import { buildRecipientSnapshot, normalizeCommunication, type CommunicationPayload } from "./communication-utils";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const context = await getApiContext(request);
  if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  const rows = await getDb().select({
    id: communications.id, title: communications.title, message: communications.message,
    audienceType: communications.audienceType, teamId: communications.teamId, teamName: teams.name,
    priority: communications.priority, status: communications.status, scheduledAt: communications.scheduledAt,
    sentAt: communications.sentAt, createdBy: communications.createdBy, createdAt: communications.createdAt,
  }).from(communications).leftJoin(teams, and(eq(teams.id, communications.teamId), eq(teams.organizationId, communications.organizationId)))
    .where(eq(communications.organizationId, context.membership.organizationId))
    .orderBy(desc(communications.createdAt)).limit(300);
  const rawRecipients = rows.length ? await getDb().select().from(communicationRecipients)
    .where(inArray(communicationRecipients.communicationId, rows.map((row) => row.id)))
    .orderBy(asc(communicationRecipients.guardianName)) : [];
  const recipientAthletes = rawRecipients.length ? await getDb().select({ id: athletes.id }).from(athletes).where(and(
    eq(athletes.organizationId, context.membership.organizationId),
    inArray(athletes.id, rawRecipients.map((recipient) => recipient.athleteId)),
  )) : [];
  const allowedAthletes = new Set(recipientAthletes.map((athlete) => athlete.id));
  const recipients = rawRecipients.filter((recipient) => allowedAthletes.has(recipient.athleteId));
  return Response.json({ communications: rows.map((row) => ({ ...row, recipients: recipients.filter((item) => item.communicationId === row.id), recipientCount: recipients.filter((item) => item.communicationId === row.id).length, readCount: recipients.filter((item) => item.communicationId === row.id && item.readAt).length })) });
}
export async function POST(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    const normalized = normalizeCommunication((await request.json()) as CommunicationPayload);
    if ("error" in normalized) return Response.json({ error: normalized.error }, { status: 400 });
    const organizationId = context.membership.organizationId;
    let recipients;
    try { recipients = await buildRecipientSnapshot(organizationId, normalized.value.audienceType, normalized.value.teamId); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Destinatários inválidos." }, { status: 404 }); }
    const id = crypto.randomUUID(); const now = Math.floor(Date.now() / 1000); const d1 = getD1();
    const statements = [d1.prepare(`INSERT INTO communications
      (id,organization_id,title,message,audience_type,team_id,priority,status,scheduled_at,sent_at,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,organizationId,normalized.value.title,normalized.value.message,normalized.value.audienceType,normalized.value.teamId,normalized.value.priority,normalized.value.status,normalized.value.scheduledAt,normalized.value.status === "sent" ? now : null,context.user.displayName || context.user.email,now,now)];
    for (const recipient of recipients) statements.push(d1.prepare(`INSERT INTO communication_recipients
      (id,communication_id,athlete_id,guardian_name,guardian_email,guardian_phone)
      VALUES(?,?,?,?,?,?)`).bind(recipient.id,id,recipient.athleteId,recipient.guardianName,recipient.guardianEmail,recipient.guardianPhone));
    await d1.batch(statements);
    return Response.json({ id, recipientCount: recipients.length }, { status: 201 });
  } catch (error) {
    console.error("Failed to create communication", error);
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível salvar o comunicado." }, { status: 500 });
  }
}
