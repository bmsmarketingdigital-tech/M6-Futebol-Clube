import { getD1 } from "../../../db";

export async function athleteHasOutstandingDebt(
  organizationId: string,
  athleteId: string,
) {
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
  await getD1()
    .prepare(`UPDATE athletes SET financial_status = ?, updated_at = unixepoch()
      WHERE id = ? AND organization_id = ?`)
    .bind(outstanding ? "pending" : "paid", athleteId, organizationId)
    .run();
  return outstanding;
}
