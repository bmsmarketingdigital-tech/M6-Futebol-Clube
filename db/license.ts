import { eq } from "drizzle-orm";
import { ensureDatabase, getD1, getDb } from "./index";
import { licenseState } from "./schema";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_GRACE_DAYS = 3;
const TRIAL_DAYS_FIRST_INSTALL = 30;
const MAX_TRACKED_NONCES = 60;
const LICENSE_ROW_ID = "default";
const MAX_ACTIVATE_ATTEMPTS = 5;

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
  if (parts.length !== 2) return { ok: false, reason: "Formato invalido" };

  let payloadBytes: Uint8Array;
  let signatureBytes: Uint8Array;
  try {
    payloadBytes = base64urlToBytes(parts[0]);
    signatureBytes = base64urlToBytes(parts[1]);
  } catch {
    return { ok: false, reason: "Base64 invalido" };
  }

  let payload: LicenseTokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { ok: false, reason: "Payload invalido" };
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

  if (!valid) return { ok: false, reason: "Assinatura invalida" };

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
      message: "Licenca nao ativada.",
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
      message: "Licenca expirada. Contate o suporte para renovar.",
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
      message: `Licenca expirada. Carencia: ${graceLeftDays} dia(s).`,
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
      message: `Licenca expira em ${daysLeft} dia(s).`,
    };
  }

  return {
    installId: row.installId,
    state: "active",
    expiresAt,
    graceDays,
    blocked: false,
    daysLeft,
    message: "Licenca ativa.",
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

  await db
    .insert(licenseState)
    .values({
      id: LICENSE_ROW_ID,
      installId,
      expiresAt: new Date(expiresAt),
      graceDays: DEFAULT_GRACE_DAYS,
      lastSeenAt: new Date(now),
      lastIssuedAt: null,
      usedNonces: "[]",
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    .onConflictDoNothing();

  const [row] = await db
    .select()
    .from(licenseState)
    .where(eq(licenseState.id, LICENSE_ROW_ID))
    .limit(1);
  if (!row) throw new Error("Nao foi possivel carregar a licenca.");

  return {
    id: row.id,
    installId: row.installId,
    expiresAt: row.expiresAt ? row.expiresAt.getTime() : null,
    graceDays: row.graceDays,
    lastSeenAt: row.lastSeenAt.getTime(),
    lastIssuedAt: row.lastIssuedAt ? row.lastIssuedAt.getTime() : null,
    usedNonces: row.usedNonces,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
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

// Compare-and-swap write used for activation: re-affirms the exact snapshot that was
// read before overwriting it. Without this, two concurrent activation calls (for
// example a network retry resubmitting the same token) both read the row before
// either writes, so the second write silently clobbers the first write expiresAt and
// usedNonces -- either losing days from a legitimate activation or double-applying a
// single token, since neither read saw the concurrent nonce as used yet
// (see P0-LICENSE-001).
async function persistRowCas(previous: LicenseRow, next: LicenseRow): Promise<boolean> {
  const d1 = getD1();
  const toSeconds = (ms: number | null) => (ms === null ? null : Math.floor(ms / 1000));
  const result = await d1
    .prepare(
      `UPDATE license_state
       SET install_id = ?, expires_at = ?, grace_days = ?, last_seen_at = ?,
           last_issued_at = ?, used_nonces = ?, updated_at = ?
       WHERE id = ?
         AND install_id = ?
         AND COALESCE(expires_at, -1) = COALESCE(?, -1)
         AND grace_days = ?
         AND last_seen_at = ?
         AND COALESCE(last_issued_at, -1) = COALESCE(?, -1)
         AND used_nonces = ?`,
    )
    .bind(
      next.installId,
      toSeconds(next.expiresAt),
      next.graceDays,
      toSeconds(next.lastSeenAt),
      toSeconds(next.lastIssuedAt),
      next.usedNonces,
      toSeconds(Date.now()),
      LICENSE_ROW_ID,
      previous.installId,
      toSeconds(previous.expiresAt),
      previous.graceDays,
      toSeconds(previous.lastSeenAt),
      toSeconds(previous.lastIssuedAt),
      previous.usedNonces,
    )
    .run();
  return (result.meta.changes ?? 0) === 1;
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
  const verified = await verifyLicenseToken(token);
  if (!verified.ok) {
    return { ok: false, code: "LICENSE_TOKEN_INVALID", reason: verified.reason };
  }

  const { installId, daysToAdd, issuedAt, nonce } = verified.payload;

  const days = Number(daysToAdd);
  if (!Number.isFinite(days) || days <= 0 || days > 3650) {
    return { ok: false, code: "LICENSE_DAYS_INVALID", reason: "Dias invalidos." };
  }

  const issued = Number(issuedAt);
  if (!Number.isFinite(issued) || issued < 0) {
    return { ok: false, code: "LICENSE_ISSUED_INVALID", reason: "issuedAt invalido." };
  }

  await ensureDatabase();

  for (let attempt = 0; attempt < MAX_ACTIVATE_ATTEMPTS; attempt++) {
    const row = await loadOrCreateRow();

    if (String(installId) !== String(row.installId)) {
      return {
        ok: false,
        code: "LICENSE_INSTALL_MISMATCH",
        reason: "Este codigo nao pertence a esta instalacao.",
      };
    }

    let usedNonces: string[];
    try {
      usedNonces = JSON.parse(row.usedNonces);
      if (!Array.isArray(usedNonces)) usedNonces = [];
    } catch {
      usedNonces = [];
    }

    if (usedNonces.includes(String(nonce))) {
      return { ok: false, code: "LICENSE_TOKEN_REUSED", reason: "Token ja utilizado." };
    }

    const lastIssued = Number(row.lastIssuedAt || 0);
    if (issued < lastIssued) {
      return { ok: false, code: "LICENSE_ISSUED_OLD", reason: "Token antigo." };
    }

    const now = Date.now();
    const base = Math.max(Number(row.expiresAt || 0), now);
    const next: LicenseRow = {
      ...row,
      expiresAt: base + days * DAY_MS,
      graceDays: DEFAULT_GRACE_DAYS,
      lastSeenAt: Math.max(now, row.lastSeenAt),
      lastIssuedAt: issued,
      usedNonces: JSON.stringify([...usedNonces, String(nonce)].slice(-MAX_TRACKED_NONCES)),
    };

    const applied = await persistRowCas(row, next);
    if (applied) {
      return { ok: true, status: computeStatus(next) };
    }
  }

  return {
    ok: false,
    code: "LICENSE_CONCURRENT_UPDATE",
    reason: "Outra ativacao esta em andamento. Tente novamente.",
  };
}

export async function isLicenseBlocked(): Promise<boolean> {
  const status = await getLicenseStatus();
  return status.blocked;
}
