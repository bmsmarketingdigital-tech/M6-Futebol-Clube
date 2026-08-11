import { activateLicense } from "../../../../db/license";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body?.token === "string" ? body.token : "";

    if (!token.trim()) {
      return Response.json(
        { ok: false, code: "LICENSE_TOKEN_EMPTY", reason: "Informe o código de ativação." },
        { status: 400 },
      );
    }

    const result = await activateLicense(token);
    if (!result.ok) {
      return Response.json(result, { status: 400 });
    }

    return Response.json(result);
  } catch (error) {
    console.error("Failed to activate license", error);
    return Response.json(
      { ok: false, code: "LICENSE_ACTIVATE_ERROR", reason: "Erro ao ativar licença." },
      { status: 500 },
    );
  }
}
