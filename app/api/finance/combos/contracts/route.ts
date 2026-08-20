import { getD1 } from "../../../../../db";
import { getPostgresClient, postgresConfigured } from "../../../../../db/postgres";
import { getApiContext } from "../../../api-auth";

export const dynamic = "force-dynamic";

function currentReferenceMonth() {
  return new Date().toISOString().slice(0, 7);
}

function toContract(row: Record<string, unknown>) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    athleteId: row.athlete_id,
    comboId: row.combo_id,
    athleteName: row.athlete_name,
    comboNameSnapshot: row.combo_name_snapshot,
    durationMonths: row.duration_months,
    baseAmountCents: row.base_amount_cents,
    discountType: row.discount_type,
    discountValue: row.discount_value,
    finalAmountCents: row.final_amount_cents,
    installmentCount: row.installment_count,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    paidInstallments: row.paid_installments,
    pendingInstallments: row.pending_installments,
    preservedMonths: row.preserved_months ? String(row.preserved_months).split(", ") : [],
    releasableMonths: row.releasable_months ? String(row.releasable_months).split(", ") : [],
  };
}

export async function GET(request: Request) {
  const context = await getApiContext(request);
  if (!context) {
    return Response.json({ error: "Nao autorizado." }, { status: 401 });
  }
  const organizationId = context.membership.organizationId;
  const month = currentReferenceMonth();

  if (postgresConfigured()) {
    const sql = getPostgresClient();
    // Mesma consulta do D1, so trocando GROUP_CONCAT (SQLite) por STRING_AGG
    // (Postgres) -- resto da logica (meses preservados vs liberaveis de
    // acordo com pagamentos/transacoes existentes) e identico.
    const rows = await sql`
      SELECT
        ac.*,
        a.full_name AS athlete_name,
        COALESCE((SELECT COUNT(*) FROM payments p WHERE p.organization_id=ac.organization_id AND p.athlete_combo_id=ac.id AND p.status='paid'),0) AS paid_installments,
        COALESCE((SELECT COUNT(*) FROM payments p WHERE p.organization_id=ac.organization_id AND p.athlete_combo_id=ac.id AND p.status IN ('open','overdue','partial')),0) AS pending_installments,
        (SELECT STRING_AGG(c.reference_month, ', ') FROM athlete_combo_coverage c WHERE c.organization_id=ac.organization_id AND c.athlete_combo_id=ac.id AND (c.reference_month <= ${month} OR c.active=0 OR NOT EXISTS (
          SELECT 1 FROM payments p
          WHERE p.organization_id=c.organization_id
            AND p.athlete_combo_id=c.athlete_combo_id
            AND p.athlete_id=c.athlete_id
            AND p.reference_month=c.reference_month
            AND p.status='open'
            AND COALESCE(p.paid_amount_cents,0)=0
            AND NOT EXISTS (SELECT 1 FROM payment_transactions t WHERE t.payment_id=p.id)
        )) AS preserved_months,
        (SELECT STRING_AGG(c.reference_month, ', ') FROM athlete_combo_coverage c WHERE c.organization_id=ac.organization_id AND c.athlete_combo_id=ac.id AND c.active=1 AND c.reference_month > ${month} AND EXISTS (
          SELECT 1 FROM payments p
          WHERE p.organization_id=c.organization_id
            AND p.athlete_combo_id=c.athlete_combo_id
            AND p.athlete_id=c.athlete_id
            AND p.reference_month=c.reference_month
            AND p.status='open'
            AND COALESCE(p.paid_amount_cents,0)=0
            AND NOT EXISTS (SELECT 1 FROM payment_transactions t WHERE t.payment_id=p.id)
        )) AS releasable_months
      FROM athlete_combos ac
      INNER JOIN athletes a
        ON a.id=ac.athlete_id
       AND a.organization_id=ac.organization_id
      WHERE ac.organization_id=${organizationId}
      ORDER BY ac.created_at DESC
    `;
    return Response.json({ contracts: rows.map((row) => toContract(row)) });
  }

  const rows = await getD1()
    .prepare(
      `SELECT
        ac.*,
        a.full_name AS athlete_name,
        COALESCE((SELECT COUNT(*) FROM payments p WHERE p.organization_id=ac.organization_id AND p.athlete_combo_id=ac.id AND p.status='paid'),0) AS paid_installments,
        COALESCE((SELECT COUNT(*) FROM payments p WHERE p.organization_id=ac.organization_id AND p.athlete_combo_id=ac.id AND p.status IN ('open','overdue','partial')),0) AS pending_installments,
        COALESCE((SELECT GROUP_CONCAT(c.reference_month, ', ') FROM athlete_combo_coverage c WHERE c.organization_id=ac.organization_id AND c.athlete_combo_id=ac.id AND (c.reference_month <= ? OR c.active=0 OR NOT EXISTS (
          SELECT 1 FROM payments p
          WHERE p.organization_id=c.organization_id
            AND p.athlete_combo_id=c.athlete_combo_id
            AND p.athlete_id=c.athlete_id
            AND p.reference_month=c.reference_month
            AND p.status='open'
            AND COALESCE(p.paid_amount_cents,0)=0
            AND NOT EXISTS (SELECT 1 FROM payment_transactions t WHERE t.payment_id=p.id)
        ))), '') AS preserved_months,
        COALESCE((SELECT GROUP_CONCAT(c.reference_month, ', ') FROM athlete_combo_coverage c WHERE c.organization_id=ac.organization_id AND c.athlete_combo_id=ac.id AND c.active=1 AND c.reference_month > ? AND EXISTS (
          SELECT 1 FROM payments p
          WHERE p.organization_id=c.organization_id
            AND p.athlete_combo_id=c.athlete_combo_id
            AND p.athlete_id=c.athlete_id
            AND p.reference_month=c.reference_month
            AND p.status='open'
            AND COALESCE(p.paid_amount_cents,0)=0
            AND NOT EXISTS (SELECT 1 FROM payment_transactions t WHERE t.payment_id=p.id)
        )), '') AS releasable_months
      FROM athlete_combos ac
      INNER JOIN athletes a
        ON a.id=ac.athlete_id
       AND a.organization_id=ac.organization_id
      WHERE ac.organization_id=?
      ORDER BY ac.created_at DESC`,
    )
    .bind(month, month, organizationId)
    .all<Record<string, unknown>>();

  return Response.json({
    contracts: (rows.results ?? []).map((row) => toContract(row)),
  });
}
