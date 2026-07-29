import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

let schemaReady: Promise<void> | null = null;

export function getD1() {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  }
  return env.DB;
}

export function getDb() {
  return drizzle(getD1(), { schema });
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
          birth_date TEXT,
          category TEXT NOT NULL,
          guardian_name TEXT NOT NULL,
          guardian_phone TEXT,
          guardian_email TEXT,
          emergency_name TEXT,
          emergency_phone TEXT,
          allergies TEXT,
          medications TEXT,
          medical_notes TEXT,
          image_authorized INTEGER NOT NULL DEFAULT 0,
          attendance_rate INTEGER NOT NULL DEFAULT 100,
          financial_status TEXT NOT NULL DEFAULT 'paid',
          active INTEGER NOT NULL DEFAULT 1,
          created_by TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS athlete_documents (
          id TEXT PRIMARY KEY NOT NULL,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
          object_key TEXT NOT NULL UNIQUE,
          file_name TEXT NOT NULL,
          content_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          kind TEXT NOT NULL DEFAULT 'other',
          uploaded_by TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS teams (
          id TEXT PRIMARY KEY NOT NULL,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          coach_name TEXT,
          schedule_days TEXT NOT NULL DEFAULT '[]',
          start_time TEXT NOT NULL DEFAULT '08:00',
          end_time TEXT NOT NULL DEFAULT '09:00',
          place TEXT NOT NULL DEFAULT 'Campo 1',
          capacity INTEGER NOT NULL DEFAULT 24,
          active INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS team_athletes (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
          active INTEGER NOT NULL DEFAULT 1,
          enrolled_at INTEGER NOT NULL
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
          "CREATE INDEX IF NOT EXISTS athlete_documents_athlete_idx ON athlete_documents (organization_id, athlete_id)",
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS teams_organization_idx ON teams (organization_id)",
        ),
        d1.prepare(
          "CREATE UNIQUE INDEX IF NOT EXISTS team_athletes_team_athlete_unique ON team_athletes (team_id, athlete_id)",
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS team_athletes_organization_idx ON team_athletes (organization_id)",
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS team_athletes_athlete_idx ON team_athletes (athlete_id)",
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
      .then(async () => {
        const columns = await d1
          .prepare("PRAGMA table_info(athletes)")
          .all<{ name: string }>();
        const existing = new Set(columns.results.map((column) => column.name));
        const additions = [
          ["birth_date", "ALTER TABLE athletes ADD COLUMN birth_date TEXT"],
          ["guardian_email", "ALTER TABLE athletes ADD COLUMN guardian_email TEXT"],
          ["emergency_name", "ALTER TABLE athletes ADD COLUMN emergency_name TEXT"],
          ["emergency_phone", "ALTER TABLE athletes ADD COLUMN emergency_phone TEXT"],
          ["allergies", "ALTER TABLE athletes ADD COLUMN allergies TEXT"],
          ["medications", "ALTER TABLE athletes ADD COLUMN medications TEXT"],
          ["medical_notes", "ALTER TABLE athletes ADD COLUMN medical_notes TEXT"],
          [
            "image_authorized",
            "ALTER TABLE athletes ADD COLUMN image_authorized INTEGER NOT NULL DEFAULT 0",
          ],
        ] as const;

        for (const [column, statement] of additions) {
          if (!existing.has(column)) {
            await d1.prepare(statement).run();
          }
        }

        const teamColumns = await d1
          .prepare("PRAGMA table_info(teams)")
          .all<{ name: string }>();
        const existingTeamColumns = new Set(
          teamColumns.results.map((column) => column.name),
        );
        const teamAdditions = [
          [
            "schedule_days",
            "ALTER TABLE teams ADD COLUMN schedule_days TEXT NOT NULL DEFAULT '[]'",
          ],
          [
            "start_time",
            "ALTER TABLE teams ADD COLUMN start_time TEXT NOT NULL DEFAULT '08:00'",
          ],
          [
            "end_time",
            "ALTER TABLE teams ADD COLUMN end_time TEXT NOT NULL DEFAULT '09:00'",
          ],
          [
            "place",
            "ALTER TABLE teams ADD COLUMN place TEXT NOT NULL DEFAULT 'Campo 1'",
          ],
        ] as const;

        for (const [column, statement] of teamAdditions) {
          if (!existingTeamColumns.has(column)) {
            await d1.prepare(statement).run();
          }
        }
      })
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
