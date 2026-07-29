import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

let schemaReady: Promise<void> | null = null;

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` before using the database.",
    );
  }

  return drizzle(env.DB, { schema });
}

export function ensureDatabase() {
  if (!schemaReady) {
    const d1 = env.DB;
    schemaReady = d1
      .batch([
        d1.prepare(`CREATE TABLE IF NOT EXISTS organizations (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS organization_members (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          email TEXT NOT NULL,
          display_name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'owner',
          created_at INTEGER NOT NULL
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS athletes (
          id TEXT PRIMARY KEY NOT NULL,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          full_name TEXT NOT NULL,
          birth_year INTEGER NOT NULL,
          category TEXT NOT NULL,
          guardian_name TEXT NOT NULL,
          guardian_phone TEXT,
          attendance_rate INTEGER NOT NULL DEFAULT 100,
          financial_status TEXT NOT NULL DEFAULT 'paid',
          active INTEGER NOT NULL DEFAULT 1,
          created_by TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS teams (
          id TEXT PRIMARY KEY NOT NULL,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          coach_name TEXT,
          capacity INTEGER NOT NULL DEFAULT 24,
          active INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS attendance_sessions (
          id TEXT PRIMARY KEY NOT NULL,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          session_date TEXT NOT NULL,
          recorded_by TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS attendance_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
          athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
          present INTEGER NOT NULL DEFAULT 1,
          note TEXT
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS payments (
          id TEXT PRIMARY KEY NOT NULL,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
          reference_month TEXT NOT NULL,
          amount_cents INTEGER NOT NULL,
          due_date TEXT NOT NULL,
          paid_at INTEGER,
          status TEXT NOT NULL DEFAULT 'open',
          created_at INTEGER NOT NULL
        )`),
        d1.prepare(
          "CREATE UNIQUE INDEX IF NOT EXISTS organization_members_org_email_unique ON organization_members (organization_id, email)",
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS organization_members_email_idx ON organization_members (email)",
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS athletes_organization_idx ON athletes (organization_id)",
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS athletes_name_idx ON athletes (organization_id, full_name)",
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS athletes_category_idx ON athletes (organization_id, category)",
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS teams_organization_idx ON teams (organization_id)",
        ),
        d1.prepare(
          "CREATE UNIQUE INDEX IF NOT EXISTS attendance_sessions_team_date_unique ON attendance_sessions (team_id, session_date)",
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS attendance_sessions_organization_idx ON attendance_sessions (organization_id)",
        ),
        d1.prepare(
          "CREATE UNIQUE INDEX IF NOT EXISTS attendance_records_session_athlete_unique ON attendance_records (session_id, athlete_id)",
        ),
        d1.prepare(
          "CREATE UNIQUE INDEX IF NOT EXISTS payments_athlete_month_unique ON payments (athlete_id, reference_month)",
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS payments_organization_status_idx ON payments (organization_id, status)",
        ),
      ])
      .then(() => undefined)
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }

  return schemaReady;
}

export async function getOrCreateOrganization(user: {
  email: string;
  displayName: string;
}) {
  await ensureDatabase();
  const db = getDb();

  const [membership] = await db
    .select({
      organizationId: schema.organizationMembers.organizationId,
      role: schema.organizationMembers.role,
    })
    .from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.email, user.email))
    .limit(1);

  if (membership) return membership;

  const organizationId = crypto.randomUUID();
  const slugBase =
    user.displayName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 30) || "baseforte";
  const now = new Date();

  await db.insert(schema.organizations).values({
    id: organizationId,
    name: "BaseForte",
    slug: `${slugBase}-${organizationId.slice(0, 6)}`,
    createdAt: now,
  });

  await db.insert(schema.organizationMembers).values({
    organizationId,
    email: user.email,
    displayName: user.displayName,
    role: "owner",
    createdAt: now,
  });

  const [created] = await db
    .select({
      organizationId: schema.organizationMembers.organizationId,
      role: schema.organizationMembers.role,
    })
    .from(schema.organizationMembers)
    .where(
      and(
        eq(schema.organizationMembers.organizationId, organizationId),
        eq(schema.organizationMembers.email, user.email),
      ),
    )
    .limit(1);

  return created;
}
