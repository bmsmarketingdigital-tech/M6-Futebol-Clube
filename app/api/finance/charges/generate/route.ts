import { getApiContext } from "../../../api-auth";
import { generateMonthlyCharges } from "../../billing-automation";
import { validateMonth } from "../../finance-utils";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    }
    const payload = (await request.json()) as { month?: string };
    const month = validateMonth(payload.month);
    if (!month) {
      return Response.json(
        { error: "Mês de referência inválido." },
        { status: 400 },
      );
    }
    return Response.json(
      await generateMonthlyCharges(
        context.membership.organizationId,
        month,
      ),
    );
  } catch (error) {
    console.error("Failed to generate monthly charges", error);
    return Response.json(
      { error: "Não foi possível gerar as mensalidades." },
      { status: 500 },
    );
  }
}
