import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import {
  athleteDocuments,
  athleteEvaluations,
  communications,
  payments,
  paymentTransactions,
} from "../../../../db/schema";
import { getPostgresClient, postgresConfigured } from "../../../../db/postgres";
import { getApiContext } from "../../api-auth";

export const dynamic = "force-dynamic";

// Chave YYYY-MM de um timestamp (segundos), no fuso America/Sao_Paulo.
function monthKey(occurredAtSeconds: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(occurredAtSeconds * 1000));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}`;
}

// Últimas 12 chaves YYYY-MM terminando no mês atual (America/Sao_Paulo), mais antiga primeiro.
function last12MonthKeys() {
  const now = new Date();
  const keys: string[] = [];
  for (let offset = 11; offset >= 0; offset -= 1) {
    const reference = new Date(now);
    reference.setUTCMonth(reference.getUTCMonth() - offset);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
    }).formatToParts(reference);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    keys.push(`${value.year}-${value.month}`);
  }
  return keys;
}

async function loadPostgresDashboardSummary(organizationId: string) {
  const sql = getPostgresClient();
  const months = last12MonthKeys();
  const oldestMonth = months[0];
  const [year, month] = oldestMonth.split("-").map(Number);
  const windowStart = Math.floor(Date.UTC(year, month - 1, 1) / 1000);

  const transactionRows = await sql<{
    type: "payment" | "refund" | "opening_balance";
    amount_cents: number;
    occurred_at: number | string;
  }[]>`
    SELECT t.type, t.amount_cents, t.occurred_at
    FROM payment_transactions t
    INNER JOIN payments p ON p.id = t.payment_id
    WHERE p.organization_id = ${organizationId}
      AND t.occurred_at >= ${windowStart}
      AND t.type IN ('payment', 'refund', 'opening_balance')
  `;

  const receivedByMonth = new Map<string, number>();
  for (const key of months) receivedByMonth.set(key, 0);
  for (const row of transactionRows) {
    const occurredAtSeconds = Number(row.occurred_at);
    if (!Number.isFinite(occurredAtSeconds)) continue;
    const key = monthKey(occurredAtSeconds);
    if (!receivedByMonth.has(key)) continue;
    const signed = row.type === "refund" ? -row.amount_cents : row.amount_cents;
    receivedByMonth.set(key, (receivedByMonth.get(key) ?? 0) + signed);
  }

  const [lastEvaluation] = await sql<{ evaluation_date: string }[]>`
    SELECT evaluation_date
    FROM athlete_evaluations
    WHERE organization_id = ${organizationId}
    ORDER BY evaluation_date DESC
    LIMIT 1
  `;
  const [evaluationCount] = await sql<{ total: string | number }[]>`
    SELECT COUNT(*)::int AS total
    FROM athlete_evaluations
    WHERE organization_id = ${organizationId}
  `;

  const [nextCommunication] = await sql<{ title: string; scheduled_at: string | null }[]>`
    SELECT title, scheduled_at
    FROM communications
    WHERE organization_id = ${organizationId}
      AND status = 'scheduled'
    ORDER BY scheduled_at
    LIMIT 1
  `;

  const [documentCount] = await sql<{ total: string | number }[]>`
    SELECT COUNT(*)::int AS total
    FROM athlete_documents
    WHERE organization_id = ${organizationId}
  `;

  return {
    revenueLast12Months: months.map((key) => ({
      month: key,
      receivedCents: Math.max(0, receivedByMonth.get(key) ?? 0),
    })),
    evaluations: {
      total: Number(evaluationCount?.total ?? 0),
      lastEvaluationDate: lastEvaluation?.evaluation_date ?? null,
    },
    nextCommunication: nextCommunication
      ? { title: nextCommunication.title, scheduledAt: nextCommunication.scheduled_at }
      : null,
    documents: { total: Number(documentCount?.total ?? 0) },
  };
}

export async function GET(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    }
    const organizationId = context.membership.organizationId;

    if (postgresConfigured()) {
      return Response.json(await loadPostgresDashboardSummary(organizationId));
    }

    const db = getDb();

    const months = last12MonthKeys();
    const oldestMonth = months[0];
    const [year, month] = oldestMonth.split("-").map(Number);
    const windowStart = Math.floor(Date.UTC(year, month - 1, 1) / 1000);

    // Receita = valor efetivamente recebido, direto do ledger imutável
    // (payment_transactions), nunca do valor nominal/contratado. Refunds
    // abatem o mês em que o dinheiro efetivamente saiu, não o mês do
    // pagamento original — cada transação é contabilizada no seu próprio
    // occurred_at.
    const transactionRows = await db
      .select({
        type: paymentTransactions.type,
        amountCents: paymentTransactions.amountCents,
        occurredAt: paymentTransactions.occurredAt,
      })
      .from(paymentTransactions)
      .innerJoin(payments, eq(payments.id, paymentTransactions.paymentId))
      .where(
        and(
          eq(payments.organizationId, organizationId),
          gte(paymentTransactions.occurredAt, new Date(windowStart * 1000)),
          inArray(paymentTransactions.type, ["payment", "refund", "opening_balance"]),
        ),
      );

    const receivedByMonth = new Map<string, number>();
    for (const key of months) receivedByMonth.set(key, 0);
    for (const row of transactionRows) {
      const key = monthKey(Math.floor(row.occurredAt.getTime() / 1000));
      if (!receivedByMonth.has(key)) continue;
      const signed = row.type === "refund" ? -row.amountCents : row.amountCents;
      receivedByMonth.set(key, (receivedByMonth.get(key) ?? 0) + signed);
    }
    const revenueLast12Months = months.map((key) => ({
      month: key,
      receivedCents: Math.max(0, receivedByMonth.get(key) ?? 0),
    }));

    const [evaluationCountRow] = await db
      .select({ id: athleteEvaluations.id, evaluationDate: athleteEvaluations.evaluationDate })
      .from(athleteEvaluations)
      .where(eq(athleteEvaluations.organizationId, organizationId))
      .orderBy(desc(athleteEvaluations.evaluationDate))
      .limit(1);
    const evaluationCountRows = await db
      .select({ id: athleteEvaluations.id })
      .from(athleteEvaluations)
      .where(eq(athleteEvaluations.organizationId, organizationId));

    const [nextCommunicationRow] = await db
      .select({
        id: communications.id,
        title: communications.title,
        scheduledAt: communications.scheduledAt,
      })
      .from(communications)
      .where(
        and(
          eq(communications.organizationId, organizationId),
          eq(communications.status, "scheduled"),
        ),
      )
      .orderBy(communications.scheduledAt)
      .limit(1);

    const documentRows = await db
      .select({ id: athleteDocuments.id })
      .from(athleteDocuments)
      .where(eq(athleteDocuments.organizationId, organizationId));

    return Response.json({
      revenueLast12Months,
      evaluations: {
        total: evaluationCountRows.length,
        lastEvaluationDate: evaluationCountRow?.evaluationDate ?? null,
      },
      nextCommunication: nextCommunicationRow
        ? { title: nextCommunicationRow.title, scheduledAt: nextCommunicationRow.scheduledAt }
        : null,
      documents: { total: documentRows.length },
    });
  } catch (error) {
    console.error("Failed to load dashboard summary", error);
    return Response.json(
      { error: "Não foi possível carregar o painel." },
      { status: 500 },
    );
  }
}
