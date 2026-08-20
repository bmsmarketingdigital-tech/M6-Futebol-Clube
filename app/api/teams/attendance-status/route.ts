import { eq, and } from "drizzle-orm";
import { getDb } from "../../../../db";
import { getPostgresClient, postgresConfigured } from "../../../../db/postgres";
import { attendanceSessions } from "../../../../db/schema";
import { getApiContext } from "../../api-auth";

export const dynamic = "force-dynamic";

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

// Status da chamada do dia para todas as turmas de uma vez, em vez de uma
// consulta por turma -- alimenta o indicador "chamada feita" nos cards de
// Início e Presença, para o professor não precisar abrir cada turma pra
// saber se já fez a chamada de hoje.
export async function GET(request: Request) {
  const context = await getApiContext(request);
  if (!context) {
    return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  }

  const date = new URL(request.url).searchParams.get("date") ?? "";
  if (!validDate(date)) {
    return Response.json({ error: "Informe uma data válida." }, { status: 400 });
  }

  const organizationId = context.membership.organizationId;
  const statuses: Record<string, "completed" | "canceled"> = {};

  if (postgresConfigured()) {
    const sql = getPostgresClient();
    const rows = await sql<{ team_id: string; status: "completed" | "canceled" }[]>`
      SELECT team_id, status FROM attendance_sessions
      WHERE organization_id = ${organizationId} AND session_date = ${date}
    `;
    for (const row of rows) statuses[row.team_id] = row.status;
  } else {
    const db = getDb();
    const rows = await db
      .select({ teamId: attendanceSessions.teamId, status: attendanceSessions.status })
      .from(attendanceSessions)
      .where(
        and(
          eq(attendanceSessions.organizationId, organizationId),
          eq(attendanceSessions.sessionDate, date),
        ),
      );
    for (const row of rows) statuses[row.teamId] = row.status;
  }

  return Response.json({ date, statuses });
}
