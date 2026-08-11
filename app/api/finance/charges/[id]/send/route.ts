import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../../../db";
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
  let reservedId: string | null = null;
  let reservedOrganizationId: string | null = null;
  let creationToken: string | null = null;
  let providerPaymentRequested = false;
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

    creationToken = crypto.randomUUID();
    reservedId = id;
    reservedOrganizationId = organizationId;
    const reservation = await getD1().prepare(`UPDATE payments
      SET external_creation_status='creating', external_creation_token=?,
          external_creation_started_at=unixepoch(), updated_at=unixepoch()
      WHERE id=? AND organization_id=? AND external_payment_id IS NULL
        AND (external_creation_status IS NULL OR external_creation_status='failed'
          OR (external_creation_status='creating' AND external_creation_started_at < unixepoch()-300))
      RETURNING id`)
      .bind(creationToken, id, organizationId).first<{ id: string }>();
    if (!reservation) {
      return Response.json(
        { error: "A emissão desta cobrança já está em andamento. Aguarde a conclusão." },
        { status: 409 },
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

    providerPaymentRequested = true;
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
        description: `Mensalidade Escola de Futebol M6 Futebol Clube - ${row.payment.referenceMonth}`,
        externalReference: row.payment.id,
      }),
    });

    const finalized = await getD1().prepare(`UPDATE payments SET
        external_provider='asaas', external_payment_id=?, invoice_url=?, bank_slip_url=?,
        external_status=?, external_creation_status='created', external_creation_token=NULL,
        external_creation_started_at=NULL, updated_at=unixepoch()
      WHERE id=? AND organization_id=? AND external_creation_status='creating'
        AND external_creation_token=? AND external_payment_id IS NULL RETURNING id`)
      .bind(external.id, external.invoiceUrl || null, external.bankSlipUrl || null,
        external.status || "PENDING", id, organizationId, creationToken).first<{ id: string }>();
    if (!finalized) throw new Error("A reserva local da cobrança foi perdida antes da confirmação.");

    return Response.json({ invoiceUrl: external.invoiceUrl, alreadySent: false });
  } catch (error) {
    try {
      if (reservedId && reservedOrganizationId && creationToken) {
        await getD1().prepare(`UPDATE payments SET external_creation_status=?,
            external_creation_token=NULL, external_creation_started_at=NULL, updated_at=unixepoch()
          WHERE id=? AND organization_id=? AND external_payment_id IS NULL
            AND external_creation_status='creating' AND external_creation_token=?`)
          .bind(providerPaymentRequested ? "unknown" : "failed", reservedId, reservedOrganizationId, creationToken).run();
      }
    } catch (cleanupError) {
      console.error("Failed to release Asaas reservation", cleanupError);
    }
    console.error("Failed to send Asaas charge", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Não foi possível emitir a cobrança." },
      { status: 500 },
    );
  }
}
