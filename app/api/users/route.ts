import { ensureDatabase, getD1 } from "../../../db";
import { getApiContext } from "../api-auth";
import {
  createManagedLocalUser,
  getLocalSessionUser,
  listManagedLocalUsers,
} from "../local-auth";

export const dynamic = "force-dynamic";

function validUsername(value: string) {
  return /^[a-z0-9._-]{3,30}$/.test(value);
}

export async function GET(request: Request) {
  const current = await getLocalSessionUser(request);
  if (!current || current.role !== "admin") {
    return Response.json({ error: "Apenas administradores podem gerenciar usuários." }, { status: 403 });
  }
  const users = await listManagedLocalUsers();
  return Response.json({
    users: users.map((user) => ({ ...user, isCurrent: user.id === current.id })),
  });
}

export async function POST(request: Request) {
  const current = await getLocalSessionUser(request);
  if (!current || current.role !== "admin") {
    return Response.json({ error: "Apenas administradores podem criar usuários." }, { status: 403 });
  }

  const body = (await request.json()) as {
    displayName?: string;
    username?: string;
    password?: string;
    role?: string;
  };
  const displayName = body.displayName?.trim() ?? "";
  const username = body.username?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  const role = body.role === "admin" ? "admin" : "operator";

  if (displayName.length < 3) {
    return Response.json({ error: "Informe o nome completo do usuário." }, { status: 400 });
  }
  if (!validUsername(username)) {
    return Response.json(
      { error: "Use de 3 a 30 letras, números, ponto, traço ou sublinhado no usuário." },
      { status: 400 },
    );
  }
  if (password.length < 8) {
    return Response.json({ error: "A senha deve ter pelo menos 8 caracteres." }, { status: 400 });
  }

  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json({ error: "Acesso não autorizado." }, { status: 403 });
    }
    const user = await createManagedLocalUser({ displayName, username, password, role });
    await ensureDatabase();
    await getD1()
      .prepare(
        `INSERT INTO organization_members
         (organization_id, email, display_name, role, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        context.membership.organizationId,
        user.email,
        user.displayName,
        role === "admin" ? "admin" : "coach",
        Date.now(),
      )
      .run();
    return Response.json({ user: { ...user, isCurrent: false } }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Não foi possível criar o usuário." },
      { status: 400 },
    );
  }
}
