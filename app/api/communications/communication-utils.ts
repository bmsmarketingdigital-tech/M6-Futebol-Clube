import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { getPostgresClient, postgresConfigured } from "../../../db/postgres";
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
  if (postgresConfigured()) {
    const sql = getPostgresClient();
    if (audienceType === "team" && teamId) {
      const team = await sql<{ id: string }[]>`
        SELECT id FROM teams
        WHERE id = ${teamId} AND organization_id = ${organizationId} AND active = 1
        LIMIT 1
      `;
      if (!team[0]) throw new Error("Turma não encontrada.");
    }
    const rows = audienceType === "team" && teamId
      ? await sql<{ athlete_id: string; guardian_name: string; guardian_email: string | null; guardian_phone: string | null }[]>`
          SELECT a.id athlete_id, a.guardian_name, a.guardian_email, a.guardian_phone
          FROM team_athletes ta
          INNER JOIN athletes a ON a.id = ta.athlete_id AND a.organization_id = ta.organization_id
          WHERE ta.organization_id = ${organizationId} AND ta.team_id = ${teamId}
            AND ta.active = 1 AND a.active = 1
          ORDER BY lower(a.guardian_name), a.id
        `
      : await sql<{ athlete_id: string; guardian_name: string; guardian_email: string | null; guardian_phone: string | null }[]>`
          SELECT id athlete_id, guardian_name, guardian_email, guardian_phone
          FROM athletes
          WHERE organization_id = ${organizationId} AND active = 1
          ORDER BY lower(guardian_name), id
        `;
    return rows.map((row) => ({
      id: crypto.randomUUID(), athleteId: row.athlete_id,
      guardianName: row.guardian_name, guardianEmail: row.guardian_email,
      guardianPhone: row.guardian_phone,
    }));
  }
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
