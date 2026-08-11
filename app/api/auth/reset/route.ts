import { resetLocalPassword } from "../../local-auth";

export async function POST(request: Request) {
  const hostname = new URL(request.url).hostname;
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    return Response.json({ error: "Redefinição local indisponível." }, { status: 403 });
  }
  const body = await request.json() as { username?: string; password?: string };
  const username = body.username?.trim() ?? "";
  const password = body.password ?? "";
  if (username.length < 3) return Response.json({ error: "Informe o usuário de acesso." }, { status: 400 });
  if (password.length < 8) return Response.json({ error: "A nova senha deve ter pelo menos 8 caracteres." }, { status: 400 });
  try {
    await resetLocalPassword(username, password);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível redefinir a senha." }, { status: 400 });
  }
}
