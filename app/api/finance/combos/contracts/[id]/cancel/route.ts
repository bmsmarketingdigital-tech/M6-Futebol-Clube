import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../../../../db";
import { getPostgresClient, postgresConfigured } from "../../../../../../../db/postgres";
import { athleteCombos } from "../../../../../../../db/schema";
import { getApiContext } from "../../../../../api-auth";

export const dynamic = "force-dynamic";

function currentReferenceMonth() {
  return new Date().toISOString().slice(0, 7);
}

type CoverageRow = {
  reference_month: string;
  active: number;
  payment_id: string | null;
  payment_status: string | null;
  paid_amount_cents: number;
  transaction_total: number;
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getApiContext(request);
  if (!context) {
    return Response.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const { id } = await params;
  const organizationId = context.membership.organizationId;

  if (postgresConfigured()) {
    return cancelContractPostgres(id, organizationId);
  }

  const [contract] = await getDb()
    .select()
    .from(athleteCombos)
    .where(and(eq(athleteCombos.id, id), eq(athleteCombos.organizationId, organizationId)))
    .limit(1);

  if (!contract) {
    return Response.json({ error: "Contrato de Combo nao encontrado." }, { status: 404 });
  }

  const d1 = getD1();
  const now = Math.floor(Date.now() / 1000);
  const currentMonth = currentReferenceMonth();
  const rows = await d1
    .prepare(
      `SELECT
        c.reference_month,
        c.active,
        p.id AS payment_id,
        p.status AS payment_status,
        COALESCE(p.paid_amount_cents,0) AS paid_amount_cents,
        COALESCE((SELECT SUM(amount_cents) FROM payment_transactions t WHERE t.payment_id = p.id),0) AS transaction_total
      FROM athlete_combo_coverage c
      LEFT JOIN payments p
        ON p.athlete_combo_id = c.athlete_combo_id
       AND p.organization_id = c.organization_id
       AND p.athlete_id = c.athlete_id
       AND p.reference_month = c.reference_month
      WHERE c.organization_id = ?
        AND c.athlete_combo_id = ?
      ORDER BY c.reference_month`,
    )
    .bind(organizationId, id)
    .all<CoverageRow>();

  const preservedMonths: string[] = [];
  const releasedMonths: string[] = [];
  const cancelledPayments: string[] = [];
  const statements = [
    d1
      .prepare(
        "UPDATE athlete_combos SET status='cancelled', updated_at=? WHERE id=? AND organization_id=? AND status!='cancelled'",
      )
      .bind(now, id, organizationId),
  ];

  for (const row of rows.results ?? []) {
    const isFuture = row.reference_month > currentMonth;
    const hasFinancialHistory = row.paid_amount_cents > 0 || row.transaction_total !== 0;
    const canRelease =
      row.active === 1 &&
      isFuture &&
      row.payment_id &&
      row.payment_status === "open" &&
      !hasFinancialHistory;

    if (!canRelease) {
      preservedMonths.push(row.reference_month);
      continue;
    }

    statements.push(
      d1
        .prepare(
          "UPDATE payments SET status='cancelled', paid_at=NULL, payment_method=NULL, updated_at=? WHERE id=? AND organization_id=? AND athlete_combo_id=? AND status='open' AND COALESCE(paid_amount_cents,0)=0 AND NOT EXISTS (SELECT 1 FROM payment_transactions WHERE payment_id=payments.id)",
        )
        .bind(now, row.payment_id, organizationId, id),
    );
    statements.push(
      d1
        .prepare(
          "UPDATE athlete_combo_coverage SET active=0, released_at=? WHERE organization_id=? AND athlete_combo_id=? AND reference_month=? AND active=1 AND EXISTS (SELECT 1 FROM payments p WHERE p.organization_id=athlete_combo_coverage.organization_id AND p.athlete_combo_id=athlete_combo_coverage.athlete_combo_id AND p.athlete_id=athlete_combo_coverage.athlete_id AND p.reference_month=athlete_combo_coverage.reference_month AND p.status='cancelled' AND COALESCE(p.paid_amount_cents,0)=0 AND NOT EXISTS (SELECT 1 FROM payment_transactions WHERE payment_id=p.id))",
        )
        .bind(now, organizationId, id, row.reference_month),
    );
    statements.push(
      d1
        .prepare(
          "DELETE FROM athlete_billing_month_reservations WHERE organization_id=? AND source_type='combo' AND source_id=? AND reference_month=? AND EXISTS (SELECT 1 FROM athlete_combo_coverage c WHERE c.organization_id=athlete_billing_month_reservations.organization_id AND c.athlete_combo_id=athlete_billing_month_reservations.source_id AND c.reference_month=athlete_billing_month_reservations.reference_month AND c.active=0 AND c.released_at=?)",
        )
        .bind(organizationId, id, row.reference_month, now),
    );
    releasedMonths.push(row.reference_month);
    cancelledPayments.push(row.payment_id);
  }

  await d1.batch(statements);

  return Response.json({
    ok: true,
    athleteComboId: id,
    status: "cancelled",
    preservedMonths,
    releasedMonths,
    cancelledPayments,
  });
}

// Mesma logica do D1 acima, traduzida para Postgres: para cada mes coberto
// pelo contrato, so libera (cancela cobranca + desativa cobertura + apaga
// reserva do mes) quando o mes e futuro, a cobrança ainda esta em aberto e
// nao tem nenhum historico financeiro (nada pago, nenhuma transacao) --
// qualquer mes com historico e preservado. Tudo dentro de uma unica
// transacao, igual ao d1.batch().
async function cancelContractPostgres(id: string, organizationId: string) {
  const sql = getPostgresClient();

  const [contract] = await sql<{ id: string }[]>`
    SELECT id FROM athlete_combos
    WHERE id = ${id} AND organization_id = ${organizationId}
    LIMIT 1
  `;
  if (!contract) {
    return Response.json({ error: "Contrato de Combo nao encontrado." }, { status: 404 });
  }

  const now = Math.floor(Date.now() / 1000);
  const currentMonth = currentReferenceMonth();

  const rows = await sql<CoverageRow[]>`
    SELECT
      c.reference_month,
      c.active,
      p.id AS payment_id,
      p.status AS payment_status,
      COALESCE(p.paid_amount_cents,0) AS paid_amount_cents,
      COALESCE((SELECT SUM(amount_cents) FROM payment_transactions t WHERE t.payment_id = p.id),0) AS transaction_total
    FROM athlete_combo_coverage c
    LEFT JOIN payments p
      ON p.athlete_combo_id = c.athlete_combo_id
     AND p.organization_id = c.organization_id
     AND p.athlete_id = c.athlete_id
     AND p.reference_month = c.reference_month
    WHERE c.organization_id = ${organizationId}
      AND c.athlete_combo_id = ${id}
    ORDER BY c.reference_month
  `;

  const preservedMonths: string[] = [];
  const releasedMonths: string[] = [];
  const cancelledPayments: string[] = [];

  await sql.begin(async (transaction) => {
    await transaction`
      UPDATE athlete_combos SET status='cancelled', updated_at=${now}
      WHERE id=${id} AND organization_id=${organizationId} AND status!='cancelled'
    `;

    for (const row of rows) {
      const isFuture = row.reference_month > currentMonth;
      const hasFinancialHistory = row.paid_amount_cents > 0 || row.transaction_total !== 0;
      const canRelease =
        row.active === 1 &&
        isFuture &&
        row.payment_id &&
        row.payment_status === "open" &&
        !hasFinancialHistory;

      if (!canRelease) {
        preservedMonths.push(row.reference_month);
        continue;
      }

      await transaction`
        UPDATE payments SET status='cancelled', paid_at=NULL, payment_method=NULL, updated_at=${now}
        WHERE id=${row.payment_id} AND organization_id=${organizationId} AND athlete_combo_id=${id}
          AND status='open' AND COALESCE(paid_amount_cents,0)=0
          AND NOT EXISTS (SELECT 1 FROM payment_transactions WHERE payment_id=payments.id)
      `;
      await transaction`
        UPDATE athlete_combo_coverage SET active=0, released_at=${now}
        WHERE organization_id=${organizationId} AND athlete_combo_id=${id}
          AND reference_month=${row.reference_month} AND active=1
          AND EXISTS (
            SELECT 1 FROM payments p
            WHERE p.organization_id=athlete_combo_coverage.organization_id
              AND p.athlete_combo_id=athlete_combo_coverage.athlete_combo_id
              AND p.athlete_id=athlete_combo_coverage.athlete_id
              AND p.reference_month=athlete_combo_coverage.reference_month
              AND p.status='cancelled' AND COALESCE(p.paid_amount_cents,0)=0
              AND NOT EXISTS (SELECT 1 FROM payment_transactions WHERE payment_id=p.id)
          )
      `;
      await transaction`
        DELETE FROM athlete_billing_month_reservations
        WHERE organization_id=${organizationId} AND source_type='combo' AND source_id=${id}
          AND reference_month=${row.reference_month}
          AND EXISTS (
            SELECT 1 FROM athlete_combo_coverage c
            WHERE c.organization_id=athlete_billing_month_reservations.organization_id
              AND c.athlete_combo_id=athlete_billing_month_reservations.source_id
              AND c.reference_month=athlete_billing_month_reservations.reference_month
              AND c.active=0 AND c.released_at=${now}
          )
      `;
      releasedMonths.push(row.reference_month);
      cancelledPayments.push(row.payment_id as string);
    }
  });

  return Response.json({
    ok: true,
    athleteComboId: id,
    status: "cancelled",
    preservedMonths,
    releasedMonths,
    cancelledPayments,
  });
}
