import { getD1 } from "../../../db";
import { getPostgresClient, postgresConfigured } from "../../../db/postgres";

export async function athleteHasOutstandingDebt(
  organizationId: string,
  athleteId: string,
) {
  if (postgresConfigured()) {
    const sql = getPostgresClient();
    const [row] = await sql<{ found: number }[]>`
      SELECT 1 AS found
      FROM payments
      WHERE organization_id = ${organizationId}
        AND athlete_id = ${athleteId}
        AND status IN ('open', 'overdue', 'partial')
        AND amount_cents - COALESCE(paid_amount_cents, 0) > 0
      LIMIT 1
    `;
    return Boolean(row);
  }

  const row = await getD1()
    .prepare(`SELECT 1 AS found FROM payments
      WHERE organization_id = ? AND athlete_id = ?
        AND status IN ('open', 'overdue', 'partial')
        AND amount_cents - COALESCE(paid_amount_cents, 0) > 0
      LIMIT 1`)
    .bind(organizationId, athleteId)
    .first<{ found: number }>();
  return Boolean(row);
}

export async function refreshAthleteFinancialStatus(
  organizationId: string,
  athleteId: string,
) {
  const outstanding = await athleteHasOutstandingDebt(organizationId, athleteId);
  if (postgresConfigured()) {
    const sql = getPostgresClient();
    await sql`
      UPDATE athletes
      SET financial_status = ${outstanding ? "pending" : "paid"},
          updated_at = ${Math.floor(Date.now() / 1000)}
      WHERE id = ${athleteId}
        AND organization_id = ${organizationId}
    `;
    return outstanding;
  }

  await getD1()
    .prepare(`UPDATE athletes SET financial_status = ?, updated_at = unixepoch()
      WHERE id = ? AND organization_id = ?`)
    .bind(outstanding ? "pending" : "paid", athleteId, organizationId)
    .run();
  return outstanding;
}
