import { getApiContext } from "../api-auth";
import { getClassReminderStatus } from "./service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json({ error: "Faça login para consultar lembretes." }, { status: 401 });
    }
    return Response.json(await getClassReminderStatus(context.membership.organizationId));
  } catch (error) {
    console.error("Failed to read class reminders", error);
    return Response.json({ error: "Não foi possível consultar os lembretes." }, { status: 500 });
  }
}
