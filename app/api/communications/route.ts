import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import { getPostgresClient, postgresConfigured } from "../../../db/postgres";
import { athletes, communicationRecipients, communications, teams } from "../../../db/schema";
import { getApiContext } from "../api-auth";
import { buildRecipientSnapshot, normalizeCommunication, type CommunicationPayload } from "./communication-utils";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    if (postgresConfigured()) {
      const sql = getPostgresClient();
      const rows = await sql<{
        id: string; title: string; message: string; audience_type: "all" | "team";
        team_id: string | null; team_name: string | null; priority: "normal" | "important" | "urgent";
        status: "draft" | "scheduled" | "sent" | "cancelled"; scheduled_at: string | null;
        sent_at: number | null; created_by: string; created_at: number;
      }[]>`
        SELECT c.id, c.title, c.message, c.audience_type, c.team_id,
               t.name team_name, c.priority, c.status, c.scheduled_at,
               c.sent_at, c.created_by, c.created_at
        FROM communications c
        LEFT JOIN teams t ON t.id = c.team_id AND t.organization_id = c.organization_id
        WHERE c.organization_id = ${context.membership.organizationId}
        ORDER BY c.created_at DESC
        LIMIT 300
      `;
      const recipients = rows.length ? await sql<{
        id: string; communication_id: string; athlete_id: string; guardian_name: string;
        guardian_email: string | null; guardian_phone: string | null; read_at: number | null;
      }[]>`
        SELECT r.id, r.communication_id, r.athlete_id, r.guardian_name,
               r.guardian_email, r.guardian_phone, r.read_at
        FROM communication_recipients r
        INNER JOIN communications c ON c.id = r.communication_id
        INNER JOIN athletes a ON a.id = r.athlete_id AND a.organization_id = c.organization_id
        WHERE c.organization_id = ${context.membership.organizationId}
          AND r.communication_id = ANY(${rows.map((row) => row.id)})
        ORDER BY lower(r.guardian_name), r.id
      ` : [];
      return Response.json({ communications: rows.map((row) => {
        const messageRecipients = recipients.filter((item) => item.communication_id === row.id).map((item) => ({
          id: item.id, communicationId: item.communication_id, athleteId: item.athlete_id,
          guardianName: item.guardian_name, guardianEmail: item.guardian_email,
          guardianPhone: item.guardian_phone, readAt: item.read_at,
        }));
        return {
          id: row.id, title: row.title, message: row.message, audienceType: row.audience_type,
          teamId: row.team_id, teamName: row.team_name, priority: row.priority, status: row.status,
          scheduledAt: row.scheduled_at, sentAt: row.sent_at, createdBy: row.created_by,
          createdAt: row.created_at, recipients: messageRecipients,
          recipientCount: messageRecipients.length,
          readCount: messageRecipients.filter((item) => item.readAt).length,
        };
      }) });
    }
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
  } catch (error) {
    console.error("Failed to list communications", error);
    return Response.json({ error: "Não foi possível carregar os comunicados." }, { status: 500 });
  }
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
    const id = crypto.randomUUID(); const now = Math.floor(Date.now() / 1000);
    if (postgresConfigured()) {
      const sql = getPostgresClient();
      await sql.begin(async (transaction) => {
        await transaction`
          INSERT INTO communications
            (id, organization_id, title, message, audience_type, team_id, priority,
             status, scheduled_at, sent_at, created_by, created_at, updated_at)
          VALUES
            (${id}, ${organizationId}, ${normalized.value.title}, ${normalized.value.message},
             ${normalized.value.audienceType}, ${normalized.value.teamId}, ${normalized.value.priority},
             ${normalized.value.status}, ${normalized.value.scheduledAt},
             ${normalized.value.status === "sent" ? now : null},
             ${context.user.displayName || context.user.email}, ${now}, ${now})
        `;
        for (const recipient of recipients) {
          await transaction`
            INSERT INTO communication_recipients
              (id, communication_id, athlete_id, guardian_name, guardian_email, guardian_phone)
            VALUES
              (${recipient.id}, ${id}, ${recipient.athleteId}, ${recipient.guardianName},
               ${recipient.guardianEmail}, ${recipient.guardianPhone})
          `;
        }
      });
      return Response.json({ id, recipientCount: recipients.length }, { status: 201 });
    }
    const d1 = getD1();
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
