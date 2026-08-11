import { ensureDatabase, getD1 } from "../../db";

export type LocalRole = "admin" | "operator";
export type LocalSessionUser = {
  id: string; email: string; username: string; displayName: string; fullName: string;
  role: LocalRole; organizationId: string;
};
export type ManagedLocalUser = {
  id: string; email: string; username: string; displayName: string;
  role: LocalRole; createdAt: number;
};
export type LocalOrganization = { id: string; name: string; role: LocalRole };

const COOKIE_NAME = "m6_session";
const SESSION_DAYS = 30;
const SESSION_HOURS = 12;
const encoder = new TextEncoder();
const effectiveRole = (role: string): LocalRole => role === "owner" || role === "admin" ? "admin" : "operator";
const membershipRole = (role: LocalRole) => role === "admin" ? "admin" : "coach";

function toHex(bytes: Uint8Array) { return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""); }
function fromHex(value: string) { const bytes = new Uint8Array(value.length / 2); for (let i = 0; i < value.length; i += 2) bytes[i / 2] = Number.parseInt(value.slice(i, i + 2), 16); return bytes; }
async function sha256(value: string) { return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))); }
async function derivePassword(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return toHex(new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 120_000 }, key, 256)));
}
function randomHex(size: number) { const bytes = new Uint8Array(size); crypto.getRandomValues(bytes); return toHex(bytes); }
function readCookie(request: Request, name: string) { const cookie = request.headers.get("cookie") ?? ""; for (const part of cookie.split(";")) { const [key, ...rest] = part.trim().split("="); if (key === name) return decodeURIComponent(rest.join("=")); } return ""; }

export async function localAccountExists() { await ensureDatabase(); return Boolean(await getD1().prepare("SELECT id FROM local_users LIMIT 1").first()); }

export async function createLocalAccount(input: { displayName: string; username: string; password: string }) {
  await ensureDatabase();
  if (await localAccountExists()) throw new Error("O administrador local já foi configurado.");
  const salt = crypto.getRandomValues(new Uint8Array(16)); const now = Date.now(); const id = crypto.randomUUID();
  const username = input.username.trim().toLowerCase(); const email = `${username}@m6.local`;
  await getD1().prepare(`INSERT INTO local_users
    (id,username,email,display_name,role,password_hash,password_salt,created_at,updated_at)
    VALUES (?,?,?,?, 'admin',?,?,?,?)`).bind(id, username, email, input.displayName.trim(), await derivePassword(input.password, salt), toHex(salt), now, now).run();
  return { id, username, email, displayName: input.displayName.trim() };
}

export async function verifyLocalCredentials(username: string, password: string) {
  await ensureDatabase();
  const user = await getD1().prepare(`SELECT id,username,email,display_name,password_hash,password_salt
    FROM local_users WHERE lower(username)=lower(?) LIMIT 1`).bind(username.trim()).first<{
      id:string;username:string;email:string;display_name:string;password_hash:string;password_salt:string;
    }>();
  if (!user || await derivePassword(password, fromHex(user.password_salt)) !== user.password_hash) return null;
  return { id:user.id, username:user.username, email:user.email, displayName:user.display_name };
}

export async function listUserOrganizations(userId: string): Promise<LocalOrganization[]> {
  await ensureDatabase();
  const rows = await getD1().prepare(`SELECT o.id,o.name,m.role FROM organization_members m
    INNER JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=? ORDER BY lower(o.name),o.id`).bind(userId).all<{id:string;name:string;role:string}>();
  return rows.results.map((row) => ({ id:row.id, name:row.name, role:effectiveRole(row.role) }));
}

export async function createLocalSession(userId: string, organizationId: string, rememberMe = false) {
  await ensureDatabase();
  const member = await getD1().prepare("SELECT 1 ok FROM organization_members WHERE user_id=? AND organization_id=? LIMIT 1").bind(userId, organizationId).first();
  if (!member) throw new Error("Organização não autorizada para este usuário.");
  const token = `${crypto.randomUUID()}${randomHex(24)}`; const now = Date.now();
  const expiresAt = now + (rememberMe ? SESSION_DAYS * 24 : SESSION_HOURS) * 60 * 60 * 1000;
  await getD1().prepare("INSERT INTO local_auth_sessions(token_hash,user_id,organization_id,expires_at,created_at) VALUES(?,?,?,?,?)")
    .bind(await sha256(token), userId, organizationId, expiresAt, now).run();
  return { token, cookie:`${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/${rememberMe ? `; Max-Age=${SESSION_DAYS*24*60*60}` : ""}` };
}

export async function getLocalSessionUser(request: Request): Promise<LocalSessionUser | null> {
  const token=readCookie(request,COOKIE_NAME); if(!token)return null; await ensureDatabase();
  const row=await getD1().prepare(`SELECT u.id,u.email,u.username,m.display_name,m.role,s.organization_id
    FROM local_auth_sessions s INNER JOIN local_users u ON u.id=s.user_id
    INNER JOIN organization_members m ON m.user_id=s.user_id AND m.organization_id=s.organization_id
    WHERE s.token_hash=? AND s.expires_at>? LIMIT 1`).bind(await sha256(token),Date.now()).first<{
      id:string;email:string;username:string;display_name:string;role:string;organization_id:string;
    }>();
  return row ? { id:row.id,email:row.email,username:row.username,displayName:row.display_name,fullName:row.display_name,role:effectiveRole(row.role),organizationId:row.organization_id } : null;
}

export async function listManagedLocalUsers(organizationId:string):Promise<ManagedLocalUser[]> {
  await ensureDatabase(); const rows=await getD1().prepare(`SELECT u.id,u.email,u.username,m.display_name,m.role,u.created_at
    FROM organization_members m INNER JOIN local_users u ON u.id=m.user_id
    WHERE m.organization_id=? ORDER BY CASE WHEN m.role IN ('owner','admin') THEN 0 ELSE 1 END,lower(m.display_name)`)
    .bind(organizationId).all<{id:string;email:string;username:string;display_name:string;role:string;created_at:number}>();
  return rows.results.map(r=>({id:r.id,email:r.email,username:r.username,displayName:r.display_name,role:effectiveRole(r.role),createdAt:r.created_at}));
}

export async function createManagedLocalUser(organizationId:string,input:{displayName:string;username:string;password:string;role:LocalRole}) {
  await ensureDatabase(); const username=input.username.trim().toLowerCase();
  if(await getD1().prepare("SELECT id FROM local_users WHERE lower(username)=lower(?) LIMIT 1").bind(username).first())throw new Error("Este usuário de acesso já está em uso.");
  const id=crypto.randomUUID(),email=`${username}@m6.local`,salt=crypto.getRandomValues(new Uint8Array(16)),now=Date.now();
  await getD1().batch([
    getD1().prepare(`INSERT INTO local_users(id,username,email,display_name,role,password_hash,password_salt,created_at,updated_at) VALUES(?,?,?,?, 'operator',?,?,?,?)`).bind(id,username,email,input.displayName.trim(),await derivePassword(input.password,salt),toHex(salt),now,now),
    getD1().prepare(`INSERT INTO organization_members(organization_id,user_id,display_name,role,created_at) VALUES(?,?,?,?,?)`).bind(organizationId,id,input.displayName.trim(),membershipRole(input.role),now),
  ]);
  return{id,username,email,displayName:input.displayName.trim(),role:input.role,createdAt:now};
}

export async function updateManagedLocalUser(organizationId:string,id:string,input:{displayName:string;username:string;role:LocalRole;password?:string}) {
  await ensureDatabase(); const current=await getD1().prepare(`SELECT u.username,m.role FROM organization_members m INNER JOIN local_users u ON u.id=m.user_id WHERE m.organization_id=? AND m.user_id=? LIMIT 1`).bind(organizationId,id).first<{username:string;role:string}>();
  if(!current)throw new Error("Usuário não encontrado.");
  const memberships=await getD1().prepare("SELECT COUNT(*) total FROM organization_members WHERE user_id=?").bind(id).first<{total:number}>();
  const username=input.username.trim().toLowerCase();
  if((memberships?.total??0)>1&&(username!==current.username||Boolean(input.password)))throw new Error("Credenciais globais de usuário compartilhado não podem ser alteradas por uma organização.");
  if(await getD1().prepare("SELECT id FROM local_users WHERE lower(username)=lower(?) AND id<>? LIMIT 1").bind(username,id).first())throw new Error("Este usuário de acesso já está em uso.");
  const statements=[getD1().prepare("UPDATE organization_members SET display_name=?,role=? WHERE organization_id=? AND user_id=?").bind(input.displayName.trim(),membershipRole(input.role),organizationId,id)];
  if((memberships?.total??0)===1){ const email=`${username}@m6.local`; if(input.password){const salt=crypto.getRandomValues(new Uint8Array(16));statements.push(getD1().prepare("UPDATE local_users SET username=?,email=?,display_name=?,password_hash=?,password_salt=?,updated_at=? WHERE id=?").bind(username,email,input.displayName.trim(),await derivePassword(input.password,salt),toHex(salt),Date.now(),id));}else{statements.push(getD1().prepare("UPDATE local_users SET username=?,email=?,display_name=?,updated_at=? WHERE id=?").bind(username,email,input.displayName.trim(),Date.now(),id));}}
  await getD1().batch(statements); return{id,username,displayName:input.displayName.trim(),role:input.role};
}

export async function deleteManagedLocalUser(organizationId:string,id:string,currentUserId:string){
  await ensureDatabase(); if(id===currentUserId)throw new Error("Você não pode excluir o usuário conectado.");
  const member=await getD1().prepare("SELECT role FROM organization_members WHERE organization_id=? AND user_id=? LIMIT 1").bind(organizationId,id).first();
  if(!member)throw new Error("Usuário não encontrado.");
  await getD1().prepare("DELETE FROM organization_members WHERE organization_id=? AND user_id=?").bind(organizationId,id).run();
  return{removed:true};
}

export async function resetLocalPassword(organizationId:string,username:string,password:string){await ensureDatabase();const row=await getD1().prepare(`SELECT u.id FROM local_users u INNER JOIN organization_members m ON m.user_id=u.id WHERE m.organization_id=? AND lower(u.username)=lower(?) LIMIT 1`).bind(organizationId,username.trim()).first<{id:string}>();if(!row)throw new Error("Usuário não encontrado.");const memberships=await getD1().prepare("SELECT COUNT(*) total FROM organization_members WHERE user_id=?").bind(row.id).first<{total:number}>();if((memberships?.total??0)!==1)throw new Error("A senha de um usuário compartilhado não pode ser redefinida por uma organização.");const salt=crypto.getRandomValues(new Uint8Array(16));await getD1().prepare("UPDATE local_users SET password_hash=?,password_salt=?,updated_at=? WHERE id=?").bind(await derivePassword(password,salt),toHex(salt),Date.now(),row.id).run();}
export async function destroyLocalSession(request:Request){const token=readCookie(request,COOKIE_NAME);if(token){await ensureDatabase();await getD1().prepare("DELETE FROM local_auth_sessions WHERE token_hash=?").bind(await sha256(token)).run();}return`${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;}
