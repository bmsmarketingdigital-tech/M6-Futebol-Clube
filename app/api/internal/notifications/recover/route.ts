import { env } from "cloudflare:workers";
import { getDb } from "../../../../../db";
import { organizations } from "../../../../../db/schema";
import { runBillingAutomation } from "../../../finance/billing-automation";
import { NotificationOrigin } from "../../../notifications/outbox";
import { processClassReminders } from "../../../reminders/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const runtime = env as unknown as Record<string, string | undefined>;
  const authorization = request.headers.get("authorization");
  if (
    !runtime.WHATSAPP_BRIDGE_TOKEN ||
    authorization !== `Bearer ${runtime.WHATSAPP_BRIDGE_TOKEN}`
  ) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  const requestedOrigin = new URL(request.url).searchParams.get("origin");
  const origin: NotificationOrigin =
    requestedOrigin === "reconnect"
      ? "reconnect"
      : requestedOrigin === "automatic"
        ? "automatic"
        : "startup";
  const rows = await getDb().select({ id: organizations.id }).from(organizations);
  const results = [];
  for (const organization of rows) {
    results.push({
      organizationId: organization.id,
      result: await runBillingAutomation(organization.id, origin),
      reminders:
        origin === "automatic"
          ? await processClassReminders(organization.id)
          : { remindersSent: 0, attempted: 0, teams: [] },
    });
  }
  return Response.json({ ok: true, results });
}
