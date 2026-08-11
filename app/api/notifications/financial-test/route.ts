import { env } from "cloudflare:workers";
import { getD1 } from "../../../../db";
import { getApiContext } from "../../api-auth";
import {
  getWhatsAppBridgeStatus,
  validateWhatsAppTestMode,
} from "../../check-in/whatsapp-bridge";
import {
  buildBillingNotification,
  getBillingNotificationSettings,
} from "../../finance/billing-automation";
import {
  financialTestIdempotencyKey,
  financialTestIdempotencyKeys,
  readFinancialTestConfiguration,
  referenceDateForFinancialTest,
  validateFinancialTestRequest,
} from "../financial-test";
import { enqueueNotification, processNotificationQueue } from "../outbox";

export const dynamic = "force-dynamic";

const activeRequests = new Set<string>();

type TestPayment = {
  paymentId: string;
  athleteId: string;
  athleteName: string;
  amountCents: number;
  paidAmountCents: number | null;
  dueDate: string;
  organizationName: string;
};

export async function POST(request: Request) {
  const context = await getApiContext(request);
  if (!context || context.role !== "admin") {
    return Response.json({ error: "Acesso administrativo obrigatorio." }, { status: 403 });
  }

  const body = (await request.json()) as {
    type?: unknown;
    testPhone?: unknown;
    runId?: unknown;
    confirmation?: unknown;
  };
  const runtime = env as unknown as Record<string, string | undefined>;
  const validation = validateFinancialTestRequest({
    ...body,
    configuration: readFinancialTestConfiguration(runtime),
  });
  if (!validation.valid) {
    return Response.json(
      { error: "Teste bloqueado: configuracao, telefone, tipo, runId ou confirmacao invalida." },
      { status: 409 },
    );
  }
  const idempotencyKey = financialTestIdempotencyKey(validation.runId, validation.type);
  if (activeRequests.has(idempotencyKey)) {
    return Response.json({ error: "Este tipo ja possui uma requisicao ativa." }, { status: 409 });
  }

  activeRequests.add(idempotencyKey);
  try {
    const whatsapp = await getWhatsAppBridgeStatus();
    if (whatsapp.status !== "connected") {
      return Response.json({ error: "WhatsApp precisa estar conectado." }, { status: 409 });
    }

    const organizationId = context.membership.organizationId;
    const runKeys = financialTestIdempotencyKeys(validation.runId);
    const active = await getD1()
      .prepare(
        `SELECT id FROM notification_outbox
         WHERE organization_id=? AND idempotency_key IN (?,?,?)
           AND status IN ('pending','processing') LIMIT 1`,
      )
      .bind(organizationId, ...runKeys)
      .first<{ id: string }>();
    if (active) {
      return Response.json({ error: "Este teste possui uma outbox ativa." }, { status: 409 });
    }

    const existing = await getD1()
      .prepare("SELECT id,status FROM notification_outbox WHERE idempotency_key=? LIMIT 1")
      .bind(idempotencyKey)
      .first<{ id: string; status: string }>();
    if (existing) {
      return Response.json(
        { error: "Este tipo ja foi executado neste teste.", existing },
        { status: 409 },
      );
    }

    const count = await getD1()
      .prepare(
        `SELECT COUNT(*) AS total FROM notification_outbox
         WHERE organization_id=? AND idempotency_key IN (?,?,?)`,
      )
      .bind(organizationId, ...runKeys)
      .first<{ total: number }>();
    if ((count?.total ?? 0) >= 3) {
      return Response.json({ error: "Limite absoluto de tres envios atingido." }, { status: 409 });
    }

    const payment = await getD1()
      .prepare(
        `SELECT p.id AS paymentId,p.athlete_id AS athleteId,a.full_name AS athleteName,
           p.amount_cents AS amountCents,p.paid_amount_cents AS paidAmountCents,
           p.due_date AS dueDate,o.name AS organizationName
         FROM payments p
         JOIN athletes a ON a.id=p.athlete_id AND a.organization_id=p.organization_id
         JOIN organizations o ON o.id=p.organization_id
         WHERE p.organization_id=? AND p.status IN ('open','overdue','partial')
           AND p.amount_cents>COALESCE(p.paid_amount_cents,0)
           AND a.active=1 AND a.guardian_phone IS NOT NULL AND trim(a.guardian_phone)<>''
         ORDER BY p.due_date,p.id LIMIT 1`,
      )
      .bind(organizationId)
      .first<TestPayment>();
    if (!payment) {
      return Response.json({ error: "Nao existe mensalidade valida para o contexto controlado." }, { status: 409 });
    }

    const settings = await getBillingNotificationSettings(organizationId);
    if (!settings.enabled) {
      return Response.json({ error: "Notificacoes financeiras estao desativadas." }, { status: 409 });
    }
    const referenceDate = referenceDateForFinancialTest(
      validation.type,
      payment.dueDate,
      settings,
    );
    const notification = buildBillingNotification(payment, referenceDate, settings);
    if (!notification || notification.type !== validation.type) {
      return Response.json({ error: "Regra financeira recusou o tipo solicitado." }, { status: 409 });
    }

    const message = `${notification.message}\n\n${payment.organizationName}\n\n[TESTE CONTROLADO]`;
    const connectorValidation = await validateWhatsAppTestMode(validation.testPhone, message);
    if (
      !connectorValidation.testMode ||
      !connectorValidation.testPhoneConfigured ||
      !connectorValidation.matches ||
      !connectorValidation.messageConfigured
    ) {
      return Response.json({ error: "Conector recusou o modo de teste fail-closed." }, { status: 409 });
    }

    const queued = await enqueueNotification({
      organizationId,
      athleteId: payment.athleteId,
      paymentId: payment.paymentId,
      eventType: validation.type,
      idempotencyKey,
      phone: validation.testPhone,
      message,
      maxAttempts: 1,
    });
    if (!queued.id) {
      return Response.json({ error: "Nao foi possivel criar a outbox controlada." }, { status: 409 });
    }

    const result = await processNotificationQueue(organizationId, "controlled_test", {
      notificationId: queued.id,
      financialTest: {
        runId: validation.runId,
        type: validation.type,
        referenceDate,
        authorizedPhone: validation.testPhone,
      },
    });
    const attempt = await getD1()
      .prepare(
        `SELECT id,status,provider_message_id AS providerMessageId
         FROM notification_attempts WHERE notification_id=? ORDER BY started_at DESC LIMIT 1`,
      )
      .bind(queued.id)
      .first<{ id: string; status: string; providerMessageId: string | null }>();
    return Response.json({
      ok: true,
      runId: validation.runId,
      type: validation.type,
      notificationId: queued.id,
      attempt: attempt ?? null,
      result,
    });
  } finally {
    activeRequests.delete(idempotencyKey);
  }
}
