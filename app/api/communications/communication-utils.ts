import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  athletes,
  teamAthletes,
  teams,
} from "../../../db/schema";

export type CommunicationPayload = {
  title?: string; message?: string; audienceType?: "all" | "team"; teamId?: string | null;
  priority?: "normal" | "important" | "urgent";
  status?: "draft" | "scheduled" | "sent"; scheduledAt?: string | null;
};

export function normalizeCommunication(payload: CommunicationPayload) {
  const title = payload.title?.trim() ?? ""; const message = payload.message?.trim() ?? "";
  const audienceType = payload.audienceType ?? "all"; const status = payload.status ?? "draft";
  if (title.length < 3 || title.length > 120) return { error: "Informe um título válido." } as const;
  if (message.length < 5 || message.length > 4000) return { error: "Escreva a mensagem do comunicado." } as const;
  if (audienceType === "team" && !payload.teamId) return { error: "Selecione a turma destinatária." } as const;
  if (status === "scheduled" && !payload.scheduledAt) return { error: "Informe a data do agendamento." } as const;
  return { value: { title, message, audienceType, teamId: audienceType === "team" ? payload.teamId! : null, priority: payload.priority ?? "normal", status, scheduledAt: status === "scheduled" ? payload.scheduledAt! : null } } as const;
}

export type CommunicationRecipientSnapshot = {
  id: string;
  athleteId: string;
  guardianName: string;
  guardianEmail: string | null;
  guardianPhone: string | null;
};

export async function buildRecipientSnapshot(organizationId: string, audienceType: "all" | "team", teamId: string | null): Promise<CommunicationRecipientSnapshot[]> {
  const db = getDb();
  let athleteIds: string[] | null = null;
  if (audienceType === "team" && teamId) {
    const [team] = await db.select({ id: teams.id }).from(teams).where(and(eq(teams.id, teamId), eq(teams.organizationId, organizationId), eq(teams.active, true))).limit(1);
    if (!team) throw new Error("Turma não encontrada.");
    athleteIds = (await db.select({ athleteId: teamAthletes.athleteId }).from(teamAthletes).where(and(eq(teamAthletes.teamId, teamId), eq(teamAthletes.organizationId, organizationId), eq(teamAthletes.active, true)))).map((row) => row.athleteId);
  }
  const conditions = [eq(athletes.organizationId, organizationId), eq(athletes.active, true)];
  if (athleteIds) {
    if (!athleteIds.length) return [];
    conditions.push(inArray(athletes.id, athleteIds));
  }
  const rows = await db.select({ athleteId: athletes.id, guardianName: athletes.guardianName, guardianEmail: athletes.guardianEmail, guardianPhone: athletes.guardianPhone }).from(athletes).where(and(...conditions));
  return rows.map((row) => ({ id: crypto.randomUUID(), ...row }));
}
