import { ensureDatabase, getD1 } from "../../../../db";
import {
  deleteManagedLocalUser,
  getLocalSessionUser,
  updateManagedLocalUser,
} from "../../local-auth";

function validUsername(value: string) {
  return /^[a-z0-9._-]{3,30}$/.test(value);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const current = await getLocalSessionUser(request);
  if (!current || current.role !== "admin") {
    return Response.json({ error: "Apenas administradores podem alterar usuários." }, { status: 403 });
  }
  const { id } = await params;
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
    return Response.json({ error: "Informe um usuário de acesso válido." }, { status: 400 });
  }
  if (password && password.length < 8) {
    return Response.json({ error: "A nova senha deve ter pelo menos 8 caracteres." }, { status: 400 });
  }
  if (id === current.id && role !== "admin") {
    return Response.json({ error: "Você não pode remover sua própria permissão de administrador." }, { status: 400 });
  }

  try {
    const updated = await updateManagedLocalUser(id, {
      displayName,
      username,
      role,
      password: password || undefined,
    });
    await ensureDatabase();
    await getD1()
      .prepare(
        `UPDATE organization_members
         SET email = ?, display_name = ?, role = ?
         WHERE lower(email) = lower(?)`,
      )
      .bind(
        updated.user.email,
        updated.user.displayName,
        role === "admin" ? "admin" : "coach",
        updated.previousEmail,
      )
      .run();
    return Response.json({
      user: { ...updated.user, isCurrent: updated.user.id === current.id },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Não foi possível alterar o usuário." },
      { status: 400 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const current = await getLocalSessionUser(request);
  if (!current || current.role !== "admin") {
    return Response.json({ error: "Apenas administradores podem excluir usuários." }, { status: 403 });
  }
  const { id } = await params;
  try {
    const deleted = await deleteManagedLocalUser(id, current.id);
    await ensureDatabase();
    await getD1()
      .prepare("DELETE FROM organization_members WHERE lower(email) = lower(?)")
      .bind(deleted.email)
      .run();
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Não foi possível excluir o usuário." },
      { status: 400 },
    );
  }
}
