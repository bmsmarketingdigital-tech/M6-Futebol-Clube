import { createLocalAccount, createLocalSession, localAccountExists } from "../../local-auth";
import { ensureDatabase, getD1, getOrCreateOrganization } from "../../../../db";

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
  const existingMembership = await getD1()
    .prepare("SELECT organization_id FROM organization_members ORDER BY id LIMIT 1")
    .first<{ organization_id: string }>();
  const sameEmail = await getD1()
    .prepare("SELECT id FROM organization_members WHERE lower(email) = lower(?) LIMIT 1")
    .bind(user.email)
    .first<{ id: number }>();
  if (existingMembership && !sameEmail) {
    await getD1()
      .prepare(
        `INSERT INTO organization_members
         (organization_id, email, display_name, role, created_at)
         VALUES (?, ?, ?, 'owner', ?)`,
      )
      .bind(existingMembership.organization_id, user.email, user.displayName, Date.now())
      .run();
  } else if (!existingMembership) {
    await getOrCreateOrganization({ email: user.email, displayName: user.displayName });
  }
  const session = await createLocalSession(user.id, Boolean(body.rememberMe));
  return Response.json(
    { authenticated: true, user: { id: user.id, email: user.email, username: user.username, displayName: user.displayName, fullName: user.displayName, role: user.role } },
    { headers: { "Set-Cookie": session.cookie } },
  );
}
