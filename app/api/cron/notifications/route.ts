import { getDb } from "../../../../db";
import { getPostgresClient, postgresConfigured } from "../../../../db/postgres";
import { organizations } from "../../../../db/schema";
import { runBillingAutomation } from "../../finance/billing-automation";
import { processClassReminders } from "../../reminders/service";
import { getRuntimeEnvValue } from "../../runtime-env";

export const dynamic = "force-dynamic";

// Gatilho para a implantação hospedada (Vercel): no desktop, quem dispara a
// automação de cobrança e os lembretes de turma é o próprio app Electron,
// chamando /api/internal/notifications/recover autenticado com o token do
// bridge do WhatsApp local. Não há processo desktop rodando junto do
// deployment hospedado, então esta rota cumpre o mesmo papel via Vercel Cron
// (ver "crons" em vercel.json), autenticada por CRON_SECRET.
//
// Ao contrário da rota interna (que libera a chamada quando o token não está
// configurado, pensada para uso local), aqui a ausência de CRON_SECRET nega
// o acesso — a rota fica exposta em uma URL pública.
function isAuthorized(request: Request) {
  const secret = getRuntimeEnvValue("CRON_SECRET");
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  const rows = postgresConfigured()
    ? await getPostgresClient()<{ id: string }[]>`SELECT id FROM organizations`
    : await getDb().select({ id: organizations.id }).from(organizations);

  const results = [];
  for (const organization of rows) {
    results.push({
      organizationId: organization.id,
      billing: await runBillingAutomation(organization.id, "automatic"),
      reminders: await processClassReminders(organization.id),
    });
  }

  return Response.json({ ok: true, results });
}
