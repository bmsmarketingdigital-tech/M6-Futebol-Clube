import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../../../db";
import { getPostgresClient, postgresConfigured } from "../../../../../../db/postgres";
import {
  athleteBilling,
  athletes,
  payments,
} from "../../../../../../db/schema";
import { getApiContext } from "../../../../api-auth";
import { asaasRequest } from "../../../asaas";

export const dynamic = "force-dynamic";

type ChargeSendRow = {
  payment: {
    id: string;
    amountCents: number;
    dueDate: string;
    referenceMonth: string;
    invoiceUrl: string | null;
    externalPaymentId: string | null;
  };
  athlete: {
    id: string;
    guardianName: string;
    guardianEmail: string | null;
    guardianPhone: string | null;
    guardianDocument: string | null;
  };
  billing: {
    id: string;
    providerCustomerId: string | null;
  };
};

async function loadPostgresChargeForSend(id: string, organizationId: string) {
  const sql = getPostgresClient();
  const [row] = await sql<{
    payment_id: string;
    amount_cents: number;
    due_date: string;
    reference_month: string;
    invoice_url: string | null;
    external_payment_id: string | null;
    athlete_id: string;
    guardian_name: string;
    guardian_email: string | null;
    guardian_phone: string | null;
    guardian_document: string | null;
    billing_id: string;
    provider_customer_id: string | null;
  }[]>`
    SELECT p.id AS payment_id,
           p.amount_cents,
           p.due_date,
           p.reference_month,
           p.invoice_url,
           p.external_payment_id,
           a.id AS athlete_id,
           a.guardian_name,
           a.guardian_email,
           a.guardian_phone,
           a.guardian_document,
           ab.id AS billing_id,
           ab.provider_customer_id
    FROM payments p
    INNER JOIN athletes a
      ON a.id = p.athlete_id
     AND a.organization_id = p.organization_id
    INNER JOIN athlete_billing ab
      ON ab.athlete_id = a.id
     AND ab.organization_id = p.organization_id
    WHERE p.id = ${id}
      AND p.organization_id = ${organizationId}
    LIMIT 1
  `;
  if (!row) return null;
  return {
    payment: {
      id: row.payment_id,
      amountCents: row.amount_cents,
      dueDate: row.due_date,
      referenceMonth: row.reference_month,
      invoiceUrl: row.invoice_url,
      externalPaymentId: row.external_payment_id,
    },
    athlete: {
      id: row.athlete_id,
      guardianName: row.guardian_name,
      guardianEmail: row.guardian_email,
      guardianPhone: row.guardian_phone,
      guardianDocument: row.guardian_document,
    },
    billing: {
      id: row.billing_id,
      providerCustomerId: row.provider_customer_id,
    },
  } satisfies ChargeSendRow;
}

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
    const usePostgres = postgresConfigured();
    const db = usePostgres ? null : getDb();
    const row = usePostgres
      ? await loadPostgresChargeForSend(id, organizationId)
      : (await db!
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
          .limit(1))[0];
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
    const reservation = usePostgres
      ? (await getPostgresClient()<{ id: string }[]>`
          UPDATE payments
          SET external_creation_status = 'creating',
              external_creation_token = ${creationToken},
              external_creation_started_at = ${Math.floor(Date.now() / 1000)},
              updated_at = ${Math.floor(Date.now() / 1000)}
          WHERE id = ${id}
            AND organization_id = ${organizationId}
            AND external_payment_id IS NULL
            AND (
              external_creation_status IS NULL
              OR external_creation_status = 'failed'
              OR (
                external_creation_status = 'creating'
                AND external_creation_started_at < ${Math.floor(Date.now() / 1000) - 300}
              )
            )
          RETURNING id
        `)[0]
      : await getD1().prepare(`UPDATE payments
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
      if (usePostgres) {
        await getPostgresClient()`
          UPDATE athlete_billing
          SET provider_customer_id = ${customerId},
              updated_at = ${Math.floor(Date.now() / 1000)}
          WHERE id = ${row.billing.id}
            AND organization_id = ${organizationId}
        `;
      } else {
        await db!
          .update(athleteBilling)
          .set({ providerCustomerId: customerId, updatedAt: new Date() })
          .where(eq(athleteBilling.id, row.billing.id));
      }
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

    const finalized = usePostgres
      ? (await getPostgresClient()<{ id: string }[]>`
          UPDATE payments
          SET external_provider = 'asaas',
              external_payment_id = ${external.id},
              invoice_url = ${external.invoiceUrl || null},
              bank_slip_url = ${external.bankSlipUrl || null},
              external_status = ${external.status || "PENDING"},
              external_creation_status = 'created',
              external_creation_token = NULL,
              external_creation_started_at = NULL,
              updated_at = ${Math.floor(Date.now() / 1000)}
          WHERE id = ${id}
            AND organization_id = ${organizationId}
            AND external_creation_status = 'creating'
            AND external_creation_token = ${creationToken}
            AND external_payment_id IS NULL
          RETURNING id
        `)[0]
      : await getD1().prepare(`UPDATE payments SET
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
        if (postgresConfigured()) {
          await getPostgresClient()`
            UPDATE payments
            SET external_creation_status = ${providerPaymentRequested ? "unknown" : "failed"},
                external_creation_token = NULL,
                external_creation_started_at = NULL,
                updated_at = ${Math.floor(Date.now() / 1000)}
            WHERE id = ${reservedId}
              AND organization_id = ${reservedOrganizationId}
              AND external_payment_id IS NULL
              AND external_creation_status = 'creating'
              AND external_creation_token = ${creationToken}
          `;
        } else {
          await getD1().prepare(`UPDATE payments SET external_creation_status=?,
              external_creation_token=NULL, external_creation_started_at=NULL, updated_at=unixepoch()
            WHERE id=? AND organization_id=? AND external_payment_id IS NULL
              AND external_creation_status='creating' AND external_creation_token=?`)
            .bind(providerPaymentRequested ? "unknown" : "failed", reservedId, reservedOrganizationId, creationToken).run();
        }
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
