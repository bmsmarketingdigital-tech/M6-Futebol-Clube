import { eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "./index";
import { licenseState } from "./schema";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_GRACE_DAYS = 3;
const TRIAL_DAYS_FIRST_INSTALL = 30;
const MAX_TRACKED_NONCES = 60;
const LICENSE_ROW_ID = "default";

const EMBEDDED_PUBLIC_KEY_PEM = `
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA23pfdemicjs+ed9X8Ur1
HU2pgbLExgTtyAJzWMtzgx2FbzjKQ9Bli3xoeqSfFAc2uF9+pf01tPp/z3vPaDh6
y1x0uQ9DIIKdzWwGywHZifZu1MB7RkP9hzHqrP9uLXquZVmrWBl/hORyoozZi9DV
t8RcqKM8s+QoD11NDJe+U3K3INBo+h/kTsHwpxQUcp7Xv0SwAULCSeYK4UlPkBpb
7idYRM03yEYwCyxifdYVmFiUmIAxyuMZTwf39MkaySkQl3Gr7PsuIsciQ7vqkeat
8QPUf9oSxl1e810Mu4MRHv1xeUZMJZ+oHcLmBQvgdswhA+qAhFHNZk82Zlg5+3J+
YQIDAQAB
-----END PUBLIC KEY-----
`.trim();

export interface LicenseStatus {
  installId: string;
  state: "unlicensed" | "blocked" | "grace" | "warning" | "active";
  expiresAt: number | null;
  graceDays: number;
  blocked: boolean;
  daysLeft: number;
  graceLeftDays?: number;
  message: string;
}

interface LicenseRow {
  id: string;
  installId: string;
  expiresAt: number | null;
  graceDays: number;
  lastSeenAt: number;
  lastIssuedAt: number | null;
  usedNonces: string;
  createdAt: number;
  updatedAt: number;
}

let cachedPublicKey: Promise<CryptoKey> | null = null;

function base64urlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function pemToBytes(pem: string): ArrayBuffer {
  const base64 = pem
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function getPublicKey(): Promise<CryptoKey> {
  if (!cachedPublicKey) {
    cachedPublicKey = crypto.subtle.importKey(
      "spki",
      pemToBytes(EMBEDDED_PUBLIC_KEY_PEM),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  }
  return cachedPublicKey;
}

interface LicenseTokenPayload {
  installId: string;
  daysToAdd: number;
  issuedAt: number;
  nonce: string;
}

interface VerifiedToken {
  ok: true;
  payload: LicenseTokenPayload;
}
interface RejectedToken {
  ok: false;
  reason: string;
}

async function verifyLicenseToken(token: string): Promise<VerifiedToken | RejectedToken> {
  if (!token || typeof token !== "string") return { ok: false, reason: "Token vazio" };

  const parts = token.trim().split(".");
  if (parts.length !== 2) return { ok: false, reason: "Formato inválido" };

  let payloadBytes: Uint8Array;
  let signatureBytes: Uint8Array;
  try {
    payloadBytes = base64urlToBytes(parts[0]);
    signatureBytes = base64urlToBytes(parts[1]);
  } catch {
    return { ok: false, reason: "Base64 inválido" };
  }

  let payload: LicenseTokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { ok: false, reason: "Payload inválido" };
  }

  if (!payload?.installId || !payload?.daysToAdd || !payload?.issuedAt || !payload?.nonce) {
    return { ok: false, reason: "Campos ausentes" };
  }

  const publicKey = await getPublicKey();
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    signatureBytes,
    payloadBytes,
  );

  if (!valid) return { ok: false, reason: "Assinatura inválida" };

  return { ok: true, payload };
}

function computeStatus(row: LicenseRow): LicenseStatus {
  const graceDays = row.graceDays ?? DEFAULT_GRACE_DAYS;
  const graceMs = graceDays * DAY_MS;
  const now = row.lastSeenAt;
  const expiresAt = row.expiresAt;

  if (!expiresAt) {
    return {
      installId: row.installId,
      state: "unlicensed",
      expiresAt: null,
      graceDays,
      blocked: true,
      daysLeft: 0,
      message: "Licença não ativada.",
    };
  }

  const blockedAt = expiresAt + graceMs;

  if (now > blockedAt) {
    return {
      installId: row.installId,
      state: "blocked",
      expiresAt,
      graceDays,
      blocked: true,
      daysLeft: 0,
      message: "Licença expirada. Contate o suporte para renovar.",
    };
  }

  if (now > expiresAt) {
    const graceLeftDays = Math.ceil((blockedAt - now) / DAY_MS);
    return {
      installId: row.installId,
      state: "grace",
      expiresAt,
      graceDays,
      blocked: false,
      daysLeft: 0,
      graceLeftDays,
      message: `Licença expirada. Carência: ${graceLeftDays} dia(s).`,
    };
  }

  const daysLeft = Math.ceil((expiresAt - now) / DAY_MS);

  if (daysLeft <= 3) {
    return {
      installId: row.installId,
      state: "warning",
      expiresAt,
      graceDays,
      blocked: false,
      daysLeft,
      message: `Licença expira em ${daysLeft} dia(s).`,
    };
  }

  return {
    installId: row.installId,
    state: "active",
    expiresAt,
    graceDays,
    blocked: false,
    daysLeft,
    message: "Licença ativa.",
  };
}

async function loadOrCreateRow(): Promise<LicenseRow> {
  await ensureDatabase();
  const db = getDb();

  const [existing] = await db
    .select()
    .from(licenseState)
    .where(eq(licenseState.id, LICENSE_ROW_ID))
    .limit(1);

  if (existing) {
    return {
      id: existing.id,
      installId: existing.installId,
      expiresAt: existing.expiresAt ? existing.expiresAt.getTime() : null,
      graceDays: existing.graceDays,
      lastSeenAt: existing.lastSeenAt.getTime(),
      lastIssuedAt: existing.lastIssuedAt ? existing.lastIssuedAt.getTime() : null,
      usedNonces: existing.usedNonces,
      createdAt: existing.createdAt.getTime(),
      updatedAt: existing.updatedAt.getTime(),
    };
  }

  const now = Date.now();
  const installId = crypto.randomUUID();
  const expiresAt = now + TRIAL_DAYS_FIRST_INSTALL * DAY_MS;

  await db.insert(licenseState).values({
    id: LICENSE_ROW_ID,
    installId,
    expiresAt: new Date(expiresAt),
    graceDays: DEFAULT_GRACE_DAYS,
    lastSeenAt: new Date(now),
    lastIssuedAt: null,
    usedNonces: "[]",
    createdAt: new Date(now),
    updatedAt: new Date(now),
  });

  return {
    id: LICENSE_ROW_ID,
    installId,
    expiresAt,
    graceDays: DEFAULT_GRACE_DAYS,
    lastSeenAt: now,
    lastIssuedAt: null,
    usedNonces: "[]",
    createdAt: now,
    updatedAt: now,
  };
}

async function persistRow(row: LicenseRow): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .update(licenseState)
    .set({
      installId: row.installId,
      expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
      graceDays: row.graceDays,
      lastSeenAt: new Date(row.lastSeenAt),
      lastIssuedAt: row.lastIssuedAt ? new Date(row.lastIssuedAt) : null,
      usedNonces: row.usedNonces,
      updatedAt: now,
    })
    .where(eq(licenseState.id, LICENSE_ROW_ID));
}

export async function getLicenseStatus(): Promise<LicenseStatus> {
  const row = await loadOrCreateRow();
  row.lastSeenAt = Math.max(Date.now(), row.lastSeenAt);
  const status = computeStatus(row);
  await persistRow(row);
  return status;
}

export type ActivateLicenseResult =
  | { ok: true; status: LicenseStatus }
  | { ok: false; code: string; reason: string };

export async function activateLicense(token: string): Promise<ActivateLicenseResult> {
  const row = await loadOrCreateRow();

  const verified = await verifyLicenseToken(token);
  if (!verified.ok) {
    return { ok: false, code: "LICENSE_TOKEN_INVALID", reason: verified.reason };
  }

  const { installId, daysToAdd, issuedAt, nonce } = verified.payload;

  if (String(installId) !== String(row.installId)) {
    return {
      ok: false,
      code: "LICENSE_INSTALL_MISMATCH",
      reason: "Este código não pertence a esta instalação.",
    };
  }

  const days = Number(daysToAdd);
  if (!Number.isFinite(days) || days <= 0 || days > 3650) {
    return { ok: false, code: "LICENSE_DAYS_INVALID", reason: "Dias inválidos." };
  }

  const issued = Number(issuedAt);
  if (!Number.isFinite(issued) || issued < 0) {
    return { ok: false, code: "LICENSE_ISSUED_INVALID", reason: "issuedAt inválido." };
  }

  let usedNonces: string[];
  try {
    usedNonces = JSON.parse(row.usedNonces);
    if (!Array.isArray(usedNonces)) usedNonces = [];
  } catch {
    usedNonces = [];
  }

  if (usedNonces.includes(String(nonce))) {
    return { ok: false, code: "LICENSE_TOKEN_REUSED", reason: "Token já utilizado." };
  }

  const lastIssued = Number(row.lastIssuedAt || 0);
  if (issued < lastIssued) {
    return { ok: false, code: "LICENSE_ISSUED_OLD", reason: "Token antigo." };
  }

  const now = Date.now();
  const base = Math.max(Number(row.expiresAt || 0), now);
  row.expiresAt = base + days * DAY_MS;
  row.graceDays = DEFAULT_GRACE_DAYS;
  row.lastSeenAt = Math.max(now, row.lastSeenAt);
  row.lastIssuedAt = issued;

  usedNonces.push(String(nonce));
  row.usedNonces = JSON.stringify(usedNonces.slice(-MAX_TRACKED_NONCES));

  await persistRow(row);

  return { ok: true, status: computeStatus(row) };
}

export async function isLicenseBlocked(): Promise<boolean> {
  const status = await getLicenseStatus();
  return status.blocked;
}
