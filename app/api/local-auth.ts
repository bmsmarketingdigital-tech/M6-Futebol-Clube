import { getPostgresClient, postgresConfigured } from "../../db/postgres";

export type LocalRole = "admin" | "operator";
export type LocalSessionUser = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  fullName: string;
  role: LocalRole;
  organizationId: string;
};
export type ManagedLocalUser = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: LocalRole;
  createdAt: number;
};
export type LocalOrganization = { id: string; name: string; role: LocalRole };

const COOKIE_NAME = "m6_session";
const SESSION_DAYS = 30;
const SESSION_HOURS = 12;
const encoder = new TextEncoder();

const effectiveRole = (role: string): LocalRole =>
  role === "owner" || role === "admin" ? "admin" : "operator";
const membershipRole = (role: LocalRole) => (role === "admin" ? "admin" : "coach");

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string) {
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < value.length; i += 2) {
    bytes[i / 2] = Number.parseInt(value.slice(i, i + 2), 16);
  }
  return bytes;
}

async function sha256(value: string) {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function derivePassword(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return toHex(
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt, iterations: 120_000 },
        key,
        256,
      ),
    ),
  );
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

async function getLocalD1() {
  const database = await import("../../db");
  await database.ensureDatabase();
  return database.getD1();
}

function cloudAuthEnabled() {
  return postgresConfigured();
}

function cloudCookieSuffix() {
  return cloudAuthEnabled() ? "; Secure" : "";
}

export async function localAccountExists() {
  if (cloudAuthEnabled()) {
    const sql = getPostgresClient();
    const rows = await sql<{ id: string }[]>`SELECT id FROM local_users LIMIT 1`;
    return Boolean(rows[0]);
  }
  const d1 = await getLocalD1();
  return Boolean(await d1.prepare("SELECT id FROM local_users LIMIT 1").first());
}

export async function createLocalAccount(input: {
  displayName: string;
  username: string;
  password: string;
}) {
  if (await localAccountExists()) throw new Error("O administrador local já foi configurado.");

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const now = Date.now();
  const id = crypto.randomUUID();
  const username = input.username.trim().toLowerCase();
  const email = `${username}@m6.local`;
  const displayName = input.displayName.trim();
  const passwordHash = await derivePassword(input.password, salt);
  const passwordSalt = toHex(salt);

  if (cloudAuthEnabled()) {
    const sql = getPostgresClient();
    await sql`INSERT INTO local_users
      (id, username, email, display_name, role, password_hash, password_salt, created_at, updated_at)
      VALUES (${id}, ${username}, ${email}, ${displayName}, 'admin', ${passwordHash}, ${passwordSalt}, ${now}, ${now})`;
  } else {
    const d1 = await getLocalD1();
    await d1
      .prepare(`INSERT INTO local_users
        (id, username, email, display_name, role, password_hash, password_salt, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'admin', ?, ?, ?, ?)`)
      .bind(id, username, email, displayName, passwordHash, passwordSalt, now, now)
      .run();
  }

  return { id, username, email, displayName };
}

export async function verifyLocalCredentials(username: string, password: string) {
  let user:
    | {
        id: string;
        username: string;
        email: string;
        display_name: string;
        password_hash: string;
        password_salt: string;
      }
    | null
    | undefined;

  if (cloudAuthEnabled()) {
    const sql = getPostgresClient();
    const rows = await sql<NonNullable<typeof user>[]>`
      SELECT id, username, email, display_name, password_hash, password_salt
      FROM local_users
      WHERE lower(username) = lower(${username.trim()})
      LIMIT 1`;
    user = rows[0];
  } else {
    const d1 = await getLocalD1();
    user = await d1
      .prepare(`SELECT id, username, email, display_name, password_hash, password_salt
        FROM local_users WHERE lower(username) = lower(?) LIMIT 1`)
      .bind(username.trim())
      .first<NonNullable<typeof user>>();
  }

  if (!user || (await derivePassword(password, fromHex(user.password_salt))) !== user.password_hash) {
    return null;
  }

  return { id: user.id, username: user.username, email: user.email, displayName: user.display_name };
}

export async function listUserOrganizations(userId: string): Promise<LocalOrganization[]> {
  if (cloudAuthEnabled()) {
    const sql = getPostgresClient();
    const rows = await sql<{ id: string; name: string; role: string }[]>`
      SELECT o.id, o.name, m.role
      FROM organization_members m
      INNER JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = ${userId}
      ORDER BY lower(o.name), o.id`;
    return rows.map((row) => ({ id: row.id, name: row.name, role: effectiveRole(row.role) }));
  }

  const d1 = await getLocalD1();
  const rows = await d1
    .prepare(`SELECT o.id, o.name, m.role
      FROM organization_members m
      INNER JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = ?
      ORDER BY lower(o.name), o.id`)
    .bind(userId)
    .all<{ id: string; name: string; role: string }>();
  return rows.results.map((row) => ({ id: row.id, name: row.name, role: effectiveRole(row.role) }));
}

export async function createLocalSession(userId: string, organizationId: string, rememberMe = false) {
  let member: unknown;

  if (cloudAuthEnabled()) {
    const sql = getPostgresClient();
    const rows = await sql<{ ok: number }[]>`
      SELECT 1 ok FROM organization_members
      WHERE user_id = ${userId} AND organization_id = ${organizationId}
      LIMIT 1`;
    member = rows[0];
  } else {
    const d1 = await getLocalD1();
    member = await d1
      .prepare("SELECT 1 ok FROM organization_members WHERE user_id = ? AND organization_id = ? LIMIT 1")
      .bind(userId, organizationId)
      .first();
  }

  if (!member) throw new Error("Organização não autorizada para este usuário.");

  const token = `${crypto.randomUUID()}${randomHex(24)}`;
  const now = Date.now();
  const expiresAt = now + (rememberMe ? SESSION_DAYS * 24 : SESSION_HOURS) * 60 * 60 * 1000;
  const tokenHash = await sha256(token);

  if (cloudAuthEnabled()) {
    const sql = getPostgresClient();
    await sql`INSERT INTO local_auth_sessions(token_hash, user_id, organization_id, expires_at, created_at)
      VALUES (${tokenHash}, ${userId}, ${organizationId}, ${expiresAt}, ${now})`;
  } else {
    const d1 = await getLocalD1();
    await d1
      .prepare("INSERT INTO local_auth_sessions(token_hash, user_id, organization_id, expires_at, created_at) VALUES(?, ?, ?, ?, ?)")
      .bind(tokenHash, userId, organizationId, expiresAt, now)
      .run();
  }

  const maxAge = rememberMe ? `; Max-Age=${SESSION_DAYS * 24 * 60 * 60}` : "";
  return {
    token,
    cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/${maxAge}${cloudCookieSuffix()}`,
  };
}

export async function getLocalSessionUser(request: Request): Promise<LocalSessionUser | null> {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return null;

  let row:
    | {
        id: string;
        email: string;
        username: string;
        display_name: string;
        role: string;
        organization_id: string;
      }
    | null
    | undefined;

  const tokenHash = await sha256(token);
  const now = Date.now();

  if (cloudAuthEnabled()) {
    const sql = getPostgresClient();
    const rows = await sql<NonNullable<typeof row>[]>`
      SELECT u.id, u.email, u.username, m.display_name, m.role, s.organization_id
      FROM local_auth_sessions s
      INNER JOIN local_users u ON u.id=s.user_id
      INNER JOIN organization_members m ON m.user_id=s.user_id AND m.organization_id=s.organization_id
      WHERE s.token_hash=${tokenHash} AND s.expires_at>${now}
      LIMIT 1`;
    row = rows[0];
  } else {
    const d1 = await getLocalD1();
    row = await d1
      .prepare(`SELECT u.id, u.email, u.username, m.display_name, m.role, s.organization_id
        FROM local_auth_sessions s
        INNER JOIN local_users u ON u.id=s.user_id
        INNER JOIN organization_members m ON m.user_id=s.user_id AND m.organization_id=s.organization_id
        WHERE s.token_hash=? AND s.expires_at>?
        LIMIT 1`)
      .bind(tokenHash, now)
      .first<NonNullable<typeof row>>();
  }

  return row
    ? {
        id: row.id,
        email: row.email,
        username: row.username,
        displayName: row.display_name,
        fullName: row.display_name,
        role: effectiveRole(row.role),
        organizationId: row.organization_id,
      }
    : null;
}

export async function listManagedLocalUsers(organizationId: string): Promise<ManagedLocalUser[]> {
  if (cloudAuthEnabled()) {
    const sql = getPostgresClient();
    const rows = await sql<{
      id: string;
      email: string;
      username: string;
      display_name: string;
      role: string;
      created_at: number;
    }[]>`
      SELECT u.id, u.email, u.username, m.display_name, m.role, u.created_at
      FROM organization_members m
      INNER JOIN local_users u ON u.id = m.user_id
      WHERE m.organization_id = ${organizationId}
      ORDER BY CASE WHEN m.role IN ('owner', 'admin') THEN 0 ELSE 1 END,
               lower(m.display_name)
    `;
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      username: row.username,
      displayName: row.display_name,
      role: effectiveRole(row.role),
      createdAt: Number(row.created_at),
    }));
  }
  const d1 = await getLocalD1();
  const rows = await d1
    .prepare(`SELECT u.id, u.email, u.username, m.display_name, m.role, u.created_at
      FROM organization_members m
      INNER JOIN local_users u ON u.id = m.user_id
      WHERE m.organization_id=?
      ORDER BY CASE WHEN m.role IN ('owner', 'admin') THEN 0 ELSE 1 END, lower(m.display_name)`)
    .bind(organizationId)
    .all<{ id: string; email: string; username: string; display_name: string; role: string; created_at: number }>();

  return rows.results.map((row) => ({
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    role: effectiveRole(row.role),
    createdAt: row.created_at,
  }));
}

export async function createManagedLocalUser(
  organizationId: string,
  input: { displayName: string; username: string; password: string; role: LocalRole },
) {
  const username = input.username.trim().toLowerCase();
  const id = crypto.randomUUID();
  const email = `${username}@m6.local`;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const now = Date.now();
  const displayName = input.displayName.trim();
  const passwordHash = await derivePassword(input.password, salt);
  const passwordSalt = toHex(salt);

  if (cloudAuthEnabled()) {
    const sql = getPostgresClient();
    const duplicate = await sql<{ id: string }[]>`
      SELECT id FROM local_users WHERE lower(username) = lower(${username}) LIMIT 1
    `;
    if (duplicate[0]) throw new Error("Este usuário de acesso já está em uso.");
    await sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO local_users
          (id, username, email, display_name, role, password_hash, password_salt, created_at, updated_at)
        VALUES
          (${id}, ${username}, ${email}, ${displayName}, 'operator', ${passwordHash}, ${passwordSalt}, ${now}, ${now})
      `;
      await transaction`
        INSERT INTO organization_members
          (organization_id, user_id, display_name, role, created_at)
        VALUES
          (${organizationId}, ${id}, ${displayName}, ${membershipRole(input.role)}, ${now})
      `;
    });
    return { id, username, email, displayName, role: input.role, createdAt: now };
  }

  const d1 = await getLocalD1();
  if (await d1.prepare("SELECT id FROM local_users WHERE lower(username) = lower(?) LIMIT 1").bind(username).first()) {
    throw new Error("Este usuário de acesso já está em uso.");
  }
  // D1 desktop keeps the same atomic operation formerly expressed as: await getD1().batch([...])
  await d1.batch([
    d1
      .prepare(`INSERT INTO local_users(id, username, email, display_name, role, password_hash, password_salt, created_at, updated_at)
        VALUES(?, ?, ?, ?, 'operator', ?, ?, ?, ?)`)
      .bind(id, username, email, displayName, passwordHash, passwordSalt, now, now),
    d1
      .prepare("INSERT INTO organization_members(organization_id, user_id, display_name, role, created_at) VALUES(?, ?, ?, ?, ?)")
      .bind(organizationId, id, displayName, membershipRole(input.role), now),
  ]);

  return { id, username, email, displayName, role: input.role, createdAt: now };
}

export async function updateManagedLocalUser(
  organizationId: string,
  id: string,
  input: { displayName: string; username: string; role: LocalRole; password?: string },
) {
  const username = input.username.trim().toLowerCase();
  const displayName = input.displayName.trim();

  if (cloudAuthEnabled()) {
    const sql = getPostgresClient();
    const currentRows = await sql<{ username: string; role: string }[]>`
      SELECT u.username, m.role
      FROM organization_members m
      INNER JOIN local_users u ON u.id = m.user_id
      WHERE m.organization_id = ${organizationId} AND m.user_id = ${id}
      LIMIT 1
    `;
    const current = currentRows[0];
    if (!current) throw new Error("Usuário não encontrado.");
    const countRows = await sql<{ total: number }[]>`
      SELECT COUNT(*)::integer total FROM organization_members WHERE user_id = ${id}
    `;
    const membershipCount = Number(countRows[0]?.total ?? 0);
    if (membershipCount > 1 && (username !== current.username || Boolean(input.password))) {
      throw new Error("Credenciais globais de usuário compartilhado não podem ser alteradas por uma organização.");
    }
    const duplicate = await sql<{ id: string }[]>`
      SELECT id FROM local_users
      WHERE lower(username) = lower(${username}) AND id <> ${id}
      LIMIT 1
    `;
    if (duplicate[0]) throw new Error("Este usuário de acesso já está em uso.");

    let passwordHash: string | null = null;
    let passwordSalt: string | null = null;
    if (input.password) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      passwordHash = await derivePassword(input.password, salt);
      passwordSalt = toHex(salt);
    }
    const now = Date.now();
    await sql.begin(async (transaction) => {
      await transaction`
        UPDATE organization_members
        SET display_name = ${displayName}, role = ${membershipRole(input.role)}
        WHERE organization_id = ${organizationId} AND user_id = ${id}
      `;
      if (membershipCount === 1) {
        const email = `${username}@m6.local`;
        if (passwordHash && passwordSalt) {
          await transaction`
            UPDATE local_users
            SET username = ${username}, email = ${email}, display_name = ${displayName},
                password_hash = ${passwordHash}, password_salt = ${passwordSalt}, updated_at = ${now}
            WHERE id = ${id}
          `;
        } else {
          await transaction`
            UPDATE local_users
            SET username = ${username}, email = ${email}, display_name = ${displayName}, updated_at = ${now}
            WHERE id = ${id}
          `;
        }
      }
    });
    return { id, username, displayName, role: input.role };
  }

  const d1 = await getLocalD1();
  const current = await d1
    .prepare(`SELECT u.username, m.role
      FROM organization_members m
      INNER JOIN local_users u ON u.id = m.user_id
      WHERE m.organization_id=? AND m.user_id=? LIMIT 1`)
    .bind(organizationId, id)
    .first<{ username: string; role: string }>();
  if (!current) throw new Error("Usuário não encontrado.");

  const memberships = await d1
    .prepare("SELECT COUNT(*) total FROM organization_members WHERE user_id = ?")
    .bind(id)
    .first<{ total: number }>();
  if ((memberships?.total ?? 0) > 1 && (username !== current.username || Boolean(input.password))) {
    throw new Error("Credenciais globais de usuário compartilhado não podem ser alteradas por uma organização.");
  }

  if (
    await d1
      .prepare("SELECT id FROM local_users WHERE lower(username) = lower(?) AND id <> ? LIMIT 1")
      .bind(username, id)
      .first()
  ) {
    throw new Error("Este usuário de acesso já está em uso.");
  }

  const statements = [
    d1
      .prepare("UPDATE organization_members SET display_name = ?, role = ? WHERE organization_id = ? AND user_id = ?")
      .bind(displayName, membershipRole(input.role), organizationId, id),
  ];

  if ((memberships?.total ?? 0) === 1) {
    const email = `${username}@m6.local`;
    if (input.password) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      statements.push(
        d1
          .prepare("UPDATE local_users SET username = ?, email = ?, display_name = ?, password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?")
          .bind(username, email, displayName, await derivePassword(input.password, salt), toHex(salt), Date.now(), id),
      );
    } else {
      statements.push(
        d1
          .prepare("UPDATE local_users SET username = ?, email = ?, display_name = ?, updated_at = ? WHERE id = ?")
          .bind(username, email, displayName, Date.now(), id),
      );
    }
  }

  // D1 desktop keeps the same atomic operation formerly expressed as: await getD1().batch(statements)
  await d1.batch(statements);
  return { id, username, displayName, role: input.role };
}

export async function deleteManagedLocalUser(organizationId: string, id: string, currentUserId: string) {
  if (id === currentUserId) throw new Error("Você não pode excluir o usuário conectado.");
  if (cloudAuthEnabled()) {
    const sql = getPostgresClient();
    const member = await sql<{ role: string }[]>`
      SELECT role FROM organization_members
      WHERE organization_id = ${organizationId} AND user_id = ${id}
      LIMIT 1
    `;
    if (!member[0]) throw new Error("Usuário não encontrado.");
    await sql`DELETE FROM organization_members WHERE organization_id = ${organizationId} AND user_id = ${id}`;
    return { removed: true };
  }
  const d1 = await getLocalD1();
  const member = await d1
    .prepare("SELECT role FROM organization_members WHERE organization_id = ? AND user_id = ? LIMIT 1")
    .bind(organizationId, id)
    .first();
  if (!member) throw new Error("Usuário não encontrado.");
  await d1.prepare("DELETE FROM organization_members WHERE organization_id=? AND user_id=?").bind(organizationId, id).run();
  return { removed: true };
}

export async function resetLocalPassword(organizationId: string, username: string, password: string) {
  if (cloudAuthEnabled()) {
    const sql = getPostgresClient();
    const rows = await sql<{ id: string }[]>`
      SELECT u.id
      FROM local_users u
      INNER JOIN organization_members m ON m.user_id = u.id
      WHERE m.organization_id = ${organizationId} AND lower(u.username) = lower(${username.trim()})
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new Error("Usuário não encontrado.");
    const counts = await sql<{ total: number }[]>`
      SELECT COUNT(*)::integer total FROM organization_members WHERE user_id = ${row.id}
    `;
    if (Number(counts[0]?.total ?? 0) !== 1) {
      throw new Error("A senha de um usuário compartilhado não pode ser redefinida por uma organização.");
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    await sql`
      UPDATE local_users
      SET password_hash = ${await derivePassword(password, salt)},
          password_salt = ${toHex(salt)}, updated_at = ${Date.now()}
      WHERE id = ${row.id}
    `;
    return;
  }
  const d1 = await getLocalD1();
  const row = await d1
    .prepare(`SELECT u.id
      FROM local_users u
      INNER JOIN organization_members m ON m.user_id = u.id
      WHERE m.organization_id = ? AND lower(u.username) = lower(?) LIMIT 1`)
    .bind(organizationId, username.trim())
    .first<{ id: string }>();
  if (!row) throw new Error("Usuário não encontrado.");

  const memberships = await d1
    .prepare("SELECT COUNT(*) total FROM organization_members WHERE user_id = ?")
    .bind(row.id)
    .first<{ total: number }>();
  if ((memberships?.total ?? 0) !== 1) {
    throw new Error("A senha de um usuário compartilhado não pode ser redefinida por uma organização.");
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  await d1
    .prepare("UPDATE local_users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?")
    .bind(await derivePassword(password, salt), toHex(salt), Date.now(), row.id)
    .run();
}

export async function destroyLocalSession(request: Request) {
  const token = readCookie(request, COOKIE_NAME);
  if (token) {
    const tokenHash = await sha256(token);
    if (cloudAuthEnabled()) {
      const sql = getPostgresClient();
      await sql`DELETE FROM local_auth_sessions WHERE token_hash = ${tokenHash}`;
    } else {
      const d1 = await getLocalD1();
      await d1.prepare("DELETE FROM local_auth_sessions WHERE token_hash=?").bind(tokenHash).run();
    }
  }
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${cloudCookieSuffix()}`;
}
