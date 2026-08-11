import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb, getD1 } from "../../../../../db";
import { athletes } from "../../../../../db/schema";
import {
  enqueueNotification,
  processNotificationQueue,
} from "../../../notifications/outbox";

export const dynamic = "force-dynamic";

const ONE_SHOT_TOKEN = "m6-controlled-test-20260810-5d7c4a91";
const IDEMPOTENCY_KEY = "controlled-test:whatsapp-integration:v2";
const TEST_MESSAGE =
  "Teste de integração do WhatsApp - Escola de Futebol M6 Futebol Clube. Esta é uma mensagem de teste do sistema.";

function normalizePhone(value: string | undefined) {
  let phone = String(value || "").replace(/\D/g, "");
  if (!phone.startsWith("55") && [10, 11].includes(phone.length)) phone = `55${phone}`;
  return phone;
}

export async function PUT(request: Request) {
  if (request.headers.get("x-controlled-test-token") !== ONE_SHOT_TOKEN) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }
  const runtime = env as unknown as Record<string, string | undefined>;
  if (!runtime.WHATSAPP_BRIDGE_URL || !runtime.WHATSAPP_BRIDGE_TOKEN) {
    return Response.json({ error: "Conector não configurado." }, { status: 409 });
  }
  const body = (await request.json()) as { phone?: string };
  const requestedPhone = normalizePhone(body.phone);
  const validationResponse = await fetch(
    `${runtime.WHATSAPP_BRIDGE_URL.replace(/\/+$/, "")}/test-mode/validate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runtime.WHATSAPP_BRIDGE_TOKEN}`,
      },
      body: JSON.stringify({ phone: requestedPhone, message: TEST_MESSAGE }),
    },
  );
  const validation = await validationResponse.json();
  return Response.json(validation, { status: validationResponse.status });
}

export async function POST(request: Request) {
  const runtime = env as unknown as Record<string, string | undefined>;
  if (request.headers.get("x-controlled-test-token") !== ONE_SHOT_TOKEN) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }
  const body = (await request.json()) as { phone?: string };
  const requestedPhone = normalizePhone(body.phone);
  if (!requestedPhone || !TEST_MESSAGE.trim()) {
    return Response.json(
      { error: "Telefone normalizado e mensagem são obrigatórios." },
      { status: 400 },
    );
  }
  if (!runtime.WHATSAPP_BRIDGE_URL || !runtime.WHATSAPP_BRIDGE_TOKEN) {
    return Response.json({ error: "Conector não configurado." }, { status: 409 });
  }
  const validationResponse = await fetch(
    `${runtime.WHATSAPP_BRIDGE_URL.replace(/\/+$/, "")}/test-mode/validate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runtime.WHATSAPP_BRIDGE_TOKEN}`,
      },
      body: JSON.stringify({ phone: requestedPhone, message: TEST_MESSAGE }),
    },
  );
  const validation = (await validationResponse.json()) as {
    testMode?: boolean;
    testPhoneConfigured?: boolean;
    matches?: boolean;
    messageConfigured?: boolean;
  };
  if (
    !validationResponse.ok ||
    !validation.testMode ||
    !validation.testPhoneConfigured ||
    !validation.matches ||
    !validation.messageConfigured
  ) {
    return Response.json(
      { error: "TEST_MODE ou telefone autorizado não corresponde ao processo." },
      { status: 409 },
    );
  }

  const db = getDb();
  const [athlete] = await db
    .select({ id: athletes.id, organizationId: athletes.organizationId })
    .from(athletes)
    .where(eq(athletes.active, true))
    .limit(1);
  if (!athlete) return Response.json({ error: "Nenhuma organização disponível." }, { status: 409 });

  const existing = await getD1()
    .prepare("SELECT id, status FROM notification_outbox WHERE idempotency_key = ?")
    .bind(IDEMPOTENCY_KEY)
    .first<{ id: string; status: string }>();
  if (existing) {
    return Response.json({ error: "Teste controlado já utilizado.", existing }, { status: 409 });
  }

  const queued = await enqueueNotification({
    organizationId: athlete.organizationId,
    athleteId: athlete.id,
    eventType: "controlled_test",
    idempotencyKey: IDEMPOTENCY_KEY,
    phone: requestedPhone,
    message: TEST_MESSAGE,
  });
  if (!queued.id) return Response.json({ error: "Não foi possível criar o teste." }, { status: 409 });
  const result = await processNotificationQueue(athlete.organizationId, "controlled_test", {
    notificationId: queued.id,
  });
  return Response.json({ ok: true, notificationId: queued.id, result });
}
