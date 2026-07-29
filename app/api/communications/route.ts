import { asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { communicationRecipients, communications, teams } from "../../../db/schema";
import { getApiContext } from "../api-auth";
import { normalizeCommunication, snapshotRecipients, type CommunicationPayload } from "./communication-utils";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const context = await getApiContext(request);
  if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  const rows = await getDb().select({
    id: communications.id, title: communications.title, message: communications.message,
    audienceType: communications.audienceType, teamId: communications.teamId, teamName: teams.name,
    priority: communications.priority, status: communications.status, scheduledAt: communications.scheduledAt,
    sentAt: communications.sentAt, createdBy: communications.createdBy, createdAt: communications.createdAt,
  }).from(communications).leftJoin(teams, eq(teams.id, communications.teamId))
    .where(eq(communications.organizationId, context.membership.organizationId))
    .orderBy(desc(communications.createdAt)).limit(300);
  const recipients = rows.length ? await getDb().select().from(communicationRecipients)
    .where(inArray(communicationRecipients.communicationId, rows.map((row) => row.id)))
    .orderBy(asc(communicationRecipients.guardianName)) : [];
  return Response.json({ communications: rows.map((row) => ({ ...row, recipients: recipients.filter((item) => item.communicationId === row.id), recipientCount: recipients.filter((item) => item.communicationId === row.id).length, readCount: recipients.filter((item) => item.communicationId === row.id && item.readAt).length })) });
}
export async function POST(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    const normalized = normalizeCommunication((await request.json()) as CommunicationPayload);
    if ("error" in normalized) return Response.json({ error: normalized.error }, { status: 400 });
    const db = getDb(); const id = crypto.randomUUID(); const now = new Date();
    await db.insert(communications).values({ id, organizationId: context.membership.organizationId, ...normalized.value, sentAt: normalized.value.status === "sent" ? now : null, createdBy: context.user.displayName || context.user.email, createdAt: now, updatedAt: now });
    const recipientCount = await snapshotRecipients(context.membership.organizationId, id, normalized.value.audienceType, normalized.value.teamId);
    return Response.json({ id, recipientCount }, { status: 201 });
  } catch (error) {
    console.error("Failed to create communication", error);
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível salvar o comunicado." }, { status: 500 });
  }
}
