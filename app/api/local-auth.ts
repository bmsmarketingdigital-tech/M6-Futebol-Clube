import { ensureDatabase, getD1 } from "../../db";

export type LocalSessionUser = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  fullName: string;
  role: "admin" | "operator";
};

export type ManagedLocalUser = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: "admin" | "operator";
  createdAt: number;
};

const COOKIE_NAME = "m6_session";
const SESSION_DAYS = 30;
const SESSION_HOURS = 12;
const encoder = new TextEncoder();

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

async function sha256(value: string) {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function derivePassword(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 120_000 },
    key,
    256,
  );
  return toHex(new Uint8Array(bits));
}

function randomHex(size: number) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

function readCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

export async function localAccountExists() {
  await ensureDatabase();
  const row = await getD1()
    .prepare("SELECT id FROM local_users LIMIT 1")
    .first<{ id: string }>();
  return Boolean(row);
}

export async function createLocalAccount(input: {
  displayName: string;
  username: string;
  password: string;
}) {
  await ensureDatabase();
  if (await localAccountExists()) throw new Error("O administrador local já foi configurado.");

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const now = Date.now();
  const userId = crypto.randomUUID();
  const username = input.username.trim().toLowerCase();
  const internalEmail = `${username}@m6.local`;
  await getD1()
    .prepare(
      `INSERT INTO local_users
       (id, username, email, display_name, role, password_hash, password_salt, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'admin', ?, ?, ?, ?)`,
    )
    .bind(
      userId,
      username,
      internalEmail,
      input.displayName.trim(),
      await derivePassword(input.password, salt),
      toHex(salt),
      now,
      now,
    )
    .run();

  return { id: userId, username, email: internalEmail, displayName: input.displayName.trim(), role: "admin" as const };
}

export async function verifyLocalCredentials(username: string, password: string) {
  await ensureDatabase();
  const user = await getD1()
    .prepare(
      "SELECT id, username, email, display_name, role, password_hash, password_salt FROM local_users WHERE lower(username) = lower(?) LIMIT 1",
    )
    .bind(username.trim())
    .first<{
      id: string;
      username: string;
      email: string;
      display_name: string;
      role: "admin" | "operator";
      password_hash: string;
      password_salt: string;
    }>();
  if (!user) return null;
  const candidate = await derivePassword(password, fromHex(user.password_salt));
  if (candidate !== user.password_hash) return null;
  return { id: user.id, username: user.username, email: user.email, displayName: user.display_name, role: user.role };
}

export async function createLocalSession(userId: string, rememberMe = false) {
  await ensureDatabase();
  const token = `${crypto.randomUUID()}${randomHex(24)}`;
  const tokenHash = await sha256(token);
  const now = Date.now();
  const expiresAt = rememberMe
    ? now + SESSION_DAYS * 24 * 60 * 60 * 1000
    : now + SESSION_HOURS * 60 * 60 * 1000;
  await getD1()
    .prepare(
      "INSERT INTO local_auth_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(tokenHash, userId, expiresAt, now)
    .run();
  return {
    token,
    cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/${
      rememberMe ? `; Max-Age=${SESSION_DAYS * 24 * 60 * 60}` : ""
    }`,
  };
}

export async function getLocalSessionUser(request: Request): Promise<LocalSessionUser | null> {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return null;
  await ensureDatabase();
  const tokenHash = await sha256(token);
  const now = Date.now();
  const row = await getD1()
    .prepare(
      `SELECT local_users.id, local_users.email, local_users.username, local_users.display_name, local_users.role
       FROM local_auth_sessions
       INNER JOIN local_users ON local_users.id = local_auth_sessions.user_id
       WHERE local_auth_sessions.token_hash = ? AND local_auth_sessions.expires_at > ?
       LIMIT 1`,
    )
    .bind(tokenHash, now)
    .first<{
      id: string;
      email: string;
      username: string;
      display_name: string;
      role: "admin" | "operator";
    }>();
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    fullName: row.display_name,
    role: row.role,
  };
}

export async function listManagedLocalUsers(): Promise<ManagedLocalUser[]> {
  await ensureDatabase();
  const rows = await getD1()
    .prepare(
      `SELECT id, email, username, display_name, role, created_at
       FROM local_users
       ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, lower(display_name)`,
    )
    .all<{
      id: string;
      email: string;
      username: string;
      display_name: string;
      role: "admin" | "operator";
      created_at: number;
    }>();
  return rows.results.map((row) => ({
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
  }));
}

export async function createManagedLocalUser(input: {
  displayName: string;
  username: string;
  password: string;
  role: "admin" | "operator";
}) {
  await ensureDatabase();
  const username = input.username.trim().toLowerCase();
  const existing = await getD1()
    .prepare("SELECT id FROM local_users WHERE lower(username) = lower(?) LIMIT 1")
    .bind(username)
    .first<{ id: string }>();
  if (existing) throw new Error("Este usuário de acesso já está em uso.");

  const id = crypto.randomUUID();
  const email = `${username}@m6.local`;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const now = Date.now();
  await getD1()
    .prepare(
      `INSERT INTO local_users
       (id, username, email, display_name, role, password_hash, password_salt, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      username,
      email,
      input.displayName.trim(),
      input.role,
      await derivePassword(input.password, salt),
      toHex(salt),
      now,
      now,
    )
    .run();
  return { id, username, email, displayName: input.displayName.trim(), role: input.role, createdAt: now };
}

export async function updateManagedLocalUser(
  id: string,
  input: {
    displayName: string;
    username: string;
    role: "admin" | "operator";
    password?: string;
  },
) {
  await ensureDatabase();
  const current = await getD1()
    .prepare("SELECT email, role FROM local_users WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ email: string; role: "admin" | "operator" }>();
  if (!current) throw new Error("Usuário não encontrado.");

  if (current.role === "admin" && input.role !== "admin") {
    const admins = await getD1()
      .prepare("SELECT COUNT(*) AS total FROM local_users WHERE role = 'admin'")
      .first<{ total: number }>();
    if ((admins?.total ?? 0) <= 1) {
      throw new Error("O sistema precisa manter pelo menos um administrador.");
    }
  }

  const username = input.username.trim().toLowerCase();
  const duplicate = await getD1()
    .prepare("SELECT id FROM local_users WHERE lower(username) = lower(?) AND id <> ? LIMIT 1")
    .bind(username, id)
    .first<{ id: string }>();
  if (duplicate) throw new Error("Este usuário de acesso já está em uso.");

  const email = `${username}@m6.local`;
  if (input.password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    await getD1()
      .prepare(
        `UPDATE local_users
         SET username = ?, email = ?, display_name = ?, role = ?,
             password_hash = ?, password_salt = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        username,
        email,
        input.displayName.trim(),
        input.role,
        await derivePassword(input.password, salt),
        toHex(salt),
        Date.now(),
        id,
      )
      .run();
  } else {
    await getD1()
      .prepare(
        `UPDATE local_users
         SET username = ?, email = ?, display_name = ?, role = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(username, email, input.displayName.trim(), input.role, Date.now(), id)
      .run();
  }
  return {
    previousEmail: current.email,
    user: { id, username, email, displayName: input.displayName.trim(), role: input.role },
  };
}

export async function deleteManagedLocalUser(id: string, currentUserId: string) {
  await ensureDatabase();
  if (id === currentUserId) throw new Error("Você não pode excluir o usuário conectado.");
  const current = await getD1()
    .prepare("SELECT email, role FROM local_users WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ email: string; role: "admin" | "operator" }>();
  if (!current) throw new Error("Usuário não encontrado.");
  if (current.role === "admin") {
    const admins = await getD1()
      .prepare("SELECT COUNT(*) AS total FROM local_users WHERE role = 'admin'")
      .first<{ total: number }>();
    if ((admins?.total ?? 0) <= 1) {
      throw new Error("O sistema precisa manter pelo menos um administrador.");
    }
  }
  await getD1().prepare("DELETE FROM local_users WHERE id = ?").bind(id).run();
  return current;
}

export async function resetLocalPassword(username: string, password: string) {
  await ensureDatabase();
  const row = await getD1().prepare("SELECT id FROM local_users WHERE lower(username) = lower(?) LIMIT 1").bind(username.trim()).first<{ id: string }>();
  if (!row) throw new Error("Usuário não encontrado.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await getD1().prepare("UPDATE local_users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?")
    .bind(await derivePassword(password, salt), toHex(salt), Date.now(), row.id).run();
}

export async function destroyLocalSession(request: Request) {
  const token = readCookie(request, COOKIE_NAME);
  if (token) {
    await ensureDatabase();
    await getD1()
      .prepare("DELETE FROM local_auth_sessions WHERE token_hash = ?")
      .bind(await sha256(token))
      .run();
  }
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}
