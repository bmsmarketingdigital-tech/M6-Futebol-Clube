import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import {
  athleteBilling,
  athletes,
  payments,
} from "../../../../../../db/schema";
import { getApiContext } from "../../../../api-auth";
import { asaasRequest } from "../../../asaas";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    }
    const { id } = await params;
    const organizationId = context.membership.organizationId;
    const db = getDb();
    const [row] = await db
      .select({
        payment: payments,
        athlete: athletes,
        billing: athleteBilling,
      })
      .from(payments)
      .innerJoin(athletes, eq(athletes.id, payments.athleteId))
      .innerJoin(athleteBilling, eq(athleteBilling.athleteId, athletes.id))
      .where(
        and(
          eq(payments.id, id),
          eq(payments.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!row) return Response.json({ error: "Cobrança não encontrada." }, { status: 404 });
    if (row.payment.externalPaymentId) {
      return Response.json({ invoiceUrl: row.payment.invoiceUrl, alreadySent: true });
    }
    if (!row.athlete.guardianDocument) {
      return Response.json(
        { error: "Cadastre o CPF ou CNPJ do responsável no perfil do atleta." },
        { status: 400 },
      );
    }

    let customerId = row.billing.providerCustomerId;
    if (!customerId) {
      const customer = await asaasRequest<{ id: string }>("/customers", {
        method: "POST",
        body: JSON.stringify({
          name: row.athlete.guardianName,
          cpfCnpj: row.athlete.guardianDocument,
          email: row.athlete.guardianEmail || undefined,
          mobilePhone: row.athlete.guardianPhone?.replace(/\D/g, "") || undefined,
          externalReference: row.athlete.id,
        }),
      });
      customerId = customer.id;
      await db
        .update(athleteBilling)
        .set({ providerCustomerId: customerId, updatedAt: new Date() })
        .where(eq(athleteBilling.id, row.billing.id));
    }

    const external = await asaasRequest<{
      id: string;
      invoiceUrl?: string;
      bankSlipUrl?: string;
      status?: string;
    }>("/payments", {
      method: "POST",
      body: JSON.stringify({
        customer: customerId,
        billingType: "UNDEFINED",
        value: row.payment.amountCents / 100,
        dueDate: row.payment.dueDate,
        description: `Mensalidade BaseForte - ${row.payment.referenceMonth}`,
        externalReference: row.payment.id,
      }),
    });

    await db
      .update(payments)
      .set({
        externalProvider: "asaas",
        externalPaymentId: external.id,
        invoiceUrl: external.invoiceUrl || null,
        bankSlipUrl: external.bankSlipUrl || null,
        externalStatus: external.status || "PENDING",
        updatedAt: new Date(),
      })
      .where(eq(payments.id, id));

    return Response.json({ invoiceUrl: external.invoiceUrl, alreadySent: false });
  } catch (error) {
    console.error("Failed to send Asaas charge", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Não foi possível emitir a cobrança." },
      { status: 500 },
    );
  }
}
