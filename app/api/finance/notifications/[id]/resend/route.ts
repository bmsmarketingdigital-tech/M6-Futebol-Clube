import { getApiContext } from "../../../../api-auth";
import {
  createManualResend,
  processNotificationQueue,
} from "../../../../notifications/outbox";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const apiContext = await getApiContext(request);
  if (!apiContext) {
    return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  }
  try {
    const { id } = await context.params;
    const organizationId = apiContext.membership.organizationId;
    const resend = await createManualResend(organizationId, id);
    const result = await processNotificationQueue(organizationId, "manual", {
      notificationId: resend.id,
    });
    return Response.json({ resendId: resend.id, result });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Não foi possível reenviar." },
      { status: 400 },
    );
  }
}
