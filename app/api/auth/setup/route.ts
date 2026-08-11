import { createLocalAccount, createLocalSession, localAccountExists } from "../../local-auth";
import { ensureDatabase, getD1 } from "../../../../db";

export async function POST(request: Request) {
  const hostname = new URL(request.url).hostname;
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    return Response.json({ error: "Configuração local indisponível." }, { status: 403 });
  }
  if (await localAccountExists()) {
    return Response.json({ error: "O administrador local já foi configurado." }, { status: 409 });
  }
  const body = (await request.json()) as { displayName?: string; username?: string; password?: string; rememberMe?: boolean };
  const displayName = body.displayName?.trim() ?? "";
  const username = body.username?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  if (displayName.length < 3) return Response.json({ error: "Informe o nome do administrador." }, { status: 400 });
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
    return Response.json({ error: "Use de 3 a 30 letras, números, ponto, traço ou sublinhado no usuário." }, { status: 400 });
  }
  if (password.length < 8) return Response.json({ error: "A senha deve ter pelo menos 8 caracteres." }, { status: 400 });

  const user = await createLocalAccount({ displayName, username, password });
  await ensureDatabase();
  const organizationId = crypto.randomUUID();
  const now = Date.now();
  await getD1().batch([
    getD1().prepare("INSERT INTO organizations(id,name,slug,created_at) VALUES(?,?,?,?)").bind(organizationId,"Escola de Futebol M6 Futebol Clube",`m6-${organizationId.slice(0,6)}`,now),
    getD1().prepare("INSERT INTO organization_members(organization_id,user_id,display_name,role,created_at) VALUES(?,?,?,'owner',?)").bind(organizationId,user.id,user.displayName,now),
  ]);
  const session = await createLocalSession(user.id, organizationId, Boolean(body.rememberMe));
  return Response.json(
    { authenticated: true, user: { id: user.id, email: user.email, username: user.username, displayName: user.displayName, fullName: user.displayName, role: "admin", organizationId } },
    { headers: { "Set-Cookie": session.cookie } },
  );
}
