import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { payments } from "../../../../db/schema";
import { validWebhookToken } from "../../finance/asaas";
import { refreshAthleteFinancialStatus } from "../../finance/debt-status";
import { findLatestReversibleTransaction, recordPaymentTransaction } from "../../finance/payment-transactions";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!validWebhookToken(request)) {
    return Response.json({ error: "Token inválido." }, { status: 401 });
  }
  const payload = (await request.json()) as {
    event?: string;
    payment?: { id?: string; status?: string; value?: number };
  };
  if (!payload.payment?.id) return Response.json({ received: true });

  const db = getDb();
  const [current] = await db
    .select()
    .from(payments)
    .where(eq(payments.externalPaymentId, payload.payment.id))
    .limit(1);
  if (!current) return Response.json({ received: true });

  const received = ["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"].includes(payload.event ?? "");
  const overdue = payload.event === "PAYMENT_OVERDUE";
  const deleted = payload.event === "PAYMENT_DELETED";
  const refunded = payload.event === "PAYMENT_REFUNDED";
  if (received) {
    const amountCents = Math.round((payload.payment.value ?? current.amountCents / 100) * 100);
    await recordPaymentTransaction({
      paymentId: current.id, type: "payment", amountCents,
      paymentMethod: "other", origin: "asaas",
      externalTransactionId: payload.payment.id,
      idempotencyKey: `asaas:payment:${payload.payment.id}:receipt`,
      note: `Recebimento confirmado pelo Asaas (${payload.event}).`,
    });
  }
  if (refunded && (current.paidAmountCents ?? 0) > 0) {
    const original = await findLatestReversibleTransaction(current.id);
    if (!original) throw new Error("Recebimento Asaas sem transação reversível correspondente.");
    await recordPaymentTransaction({
      paymentId: current.id, type: "refund",
      amountCents: Math.min(current.paidAmountCents ?? 0, original.reversibleCents),
      origin: "asaas", externalTransactionId: payload.payment.id,
      reversesTransactionId: original.id,
      idempotencyKey: `asaas:payment:${payload.payment.id}:refund`,
      note: "Estorno confirmado pelo Asaas.",
    });
  }
  const stateUpdate: { status?: "overdue" | "cancelled"; externalStatus: string; updatedAt: Date } = {
    externalStatus: payload.payment.status || payload.event || current.externalStatus,
    updatedAt: new Date(),
  };
  if (overdue) stateUpdate.status = "overdue";
  if (deleted && (current.paidAmountCents ?? 0) === 0) stateUpdate.status = "cancelled";
  await db.update(payments).set(stateUpdate).where(eq(payments.id, current.id));
  return Response.json({ received: true });
}
