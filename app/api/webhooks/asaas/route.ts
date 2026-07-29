import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { athletes, payments } from "../../../../db/schema";
import { validWebhookToken } from "../../finance/asaas";

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
  const cancelled = ["PAYMENT_DELETED", "PAYMENT_REFUNDED"].includes(payload.event ?? "");
  await db
    .update(payments)
    .set({
      status: received ? "paid" : overdue ? "overdue" : cancelled ? "cancelled" : current.status,
      paidAt: received ? new Date() : current.paidAt,
      paidAmountCents: received ? Math.round((payload.payment.value ?? current.amountCents / 100) * 100) : current.paidAmountCents,
      paymentMethod: received ? "other" : current.paymentMethod,
      externalStatus: payload.payment.status || payload.event || current.externalStatus,
      updatedAt: new Date(),
    })
    .where(eq(payments.id, current.id));

  if (received) {
    const [outstanding] = await db
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.athleteId, current.athleteId),
          inArray(payments.status, ["open", "overdue"]),
        ),
      )
      .limit(1);
    await db
      .update(athletes)
      .set({
        financialStatus: outstanding ? "pending" : "paid",
        updatedAt: new Date(),
      })
      .where(eq(athletes.id, current.athleteId));
  }
  return Response.json({ received: true });
}
