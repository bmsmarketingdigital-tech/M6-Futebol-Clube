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
        d1.prepare(`CREATE TABLE IF NOT EXISTS sports_categories (
          id TEXT PRIMARY KEY NOT NULL,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS athletes (
          id TEXT PRIMARY KEY NOT NULL,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          full_name TEXT NOT NULL,
          birth_year INTEGER NOT NULL,
          birth_date TEXT,
          category TEXT NOT NULL,
          guardian_name TEXT NOT NULL,
          guardian_document TEXT,
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
          qr_token TEXT,
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
          status TEXT NOT NULL DEFAULT 'completed',
          canceled_at INTEGER,
          canceled_by TEXT,
          cancel_reason TEXT,
          created_at INTEGER NOT NULL
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS class_reminders (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          session_date TEXT NOT NULL,
          sent_at INTEGER NOT NULL,
          recipient_count INTEGER NOT NULL DEFAULT 0
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS attendance_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
          athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
          present INTEGER NOT NULL DEFAULT 1,
          note TEXT
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS athlete_check_ins (
          id TEXT PRIMARY KEY NOT NULL,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
          team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          attendance_session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
          scanned_at INTEGER NOT NULL,
          scanned_by TEXT NOT NULL,
          guardian_phone TEXT,
          notification_message TEXT NOT NULL,
          notification_status TEXT NOT NULL DEFAULT 'pending',
          notification_error TEXT,
          notified_at INTEGER
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS athlete_evaluations (
          id TEXT PRIMARY KEY NOT NULL,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
          evaluation_date TEXT NOT NULL,
          technical_score INTEGER NOT NULL,
          physical_score INTEGER NOT NULL,
          tactical_score INTEGER NOT NULL,
          behavioral_score INTEGER NOT NULL,
          strengths TEXT,
          improvements TEXT,
          next_goals TEXT,
          evaluated_by TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS training_sessions (
          id TEXT PRIMARY KEY NOT NULL,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          team_id TEXT NOT NULL REFERENCES teams(id),
          title TEXT NOT NULL,
          objective TEXT NOT NULL,
          session_date TEXT NOT NULL,
          duration_minutes INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'planned',
          notes TEXT,
          created_by TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS training_drills (
          id TEXT PRIMARY KEY NOT NULL,
          session_id TEXT NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
          position INTEGER NOT NULL,
          name TEXT NOT NULL,
          focus TEXT,
          duration_minutes INTEGER NOT NULL,
          description TEXT
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS communications (
          id TEXT PRIMARY KEY NOT NULL,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          audience_type TEXT NOT NULL,
          team_id TEXT REFERENCES teams(id),
          priority TEXT NOT NULL DEFAULT 'normal',
          status TEXT NOT NULL DEFAULT 'draft',
          scheduled_at TEXT,
          sent_at INTEGER,
          created_by TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS communication_recipients (
          id TEXT PRIMARY KEY NOT NULL,
          communication_id TEXT NOT NULL REFERENCES communications(id) ON DELETE CASCADE,
          athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
          guardian_name TEXT NOT NULL,
          guardian_email TEXT,
          guardian_phone TEXT,
          read_at INTEGER
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS billing_plans (
          id TEXT PRIMARY KEY NOT NULL,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          amount_cents INTEGER NOT NULL,
          due_day INTEGER NOT NULL DEFAULT 10,
          category TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS athlete_billing (
          id TEXT PRIMARY KEY NOT NULL,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
          plan_id TEXT NOT NULL REFERENCES billing_plans(id),
          discount_type TEXT NOT NULL DEFAULT 'none',
          discount_value INTEGER NOT NULL DEFAULT 0,
          custom_due_day INTEGER,
          provider_customer_id TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS payments (
          id TEXT PRIMARY KEY NOT NULL,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
          reference_month TEXT NOT NULL,
          amount_cents INTEGER NOT NULL,
          due_date TEXT NOT NULL,
          paid_at INTEGER,
          paid_amount_cents INTEGER,
          payment_method TEXT,
          plan_name TEXT,
          notes TEXT,
          external_provider TEXT,
          external_payment_id TEXT,
          invoice_url TEXT,
          bank_slip_url TEXT,
          external_status TEXT,
          updated_at INTEGER NOT NULL,
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
          "CREATE UNIQUE INDEX IF NOT EXISTS sports_categories_org_name_unique ON sports_categories (organization_id, name)",
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS sports_categories_org_order_idx ON sports_categories (organization_id, sort_order)",
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
          "CREATE UNIQUE INDEX IF NOT EXISTS class_reminders_team_date_unique ON class_reminders (team_id, session_date)",
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS class_reminders_organization_idx ON class_reminders (organization_id)",
        ),
        d1.prepare(
          "CREATE UNIQUE INDEX IF NOT EXISTS attendance_records_session_athlete_unique ON attendance_records (session_id, athlete_id)",
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS athlete_check_ins_org_date_idx ON athlete_check_ins (organization_id, scanned_at)",
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS athlete_check_ins_athlete_date_idx ON athlete_check_ins (athlete_id, scanned_at)",
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS athlete_check_ins_notification_idx ON athlete_check_ins (organization_id, notification_status)",
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS athlete_evaluations_organization_idx ON athlete_evaluations (organization_id)",
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS athlete_evaluations_athlete_date_idx ON athlete_evaluations (athlete_id, evaluation_date)",
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS training_sessions_organization_date_idx ON training_sessions (organization_id, session_date)",
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS training_sessions_team_idx ON training_sessions (team_id)",
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS training_drills_session_position_idx ON training_drills (session_id, position)",
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS communications_organization_status_idx ON communications (organization_id, status)",
        ),
        d1.prepare(
          "CREATE UNIQUE INDEX IF NOT EXISTS communication_recipients_message_athlete_unique ON communication_recipients (communication_id, athlete_id)",
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS communication_recipients_message_idx ON communication_recipients (communication_id)",
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS billing_plans_organization_idx ON billing_plans (organization_id)",
        ),
        d1.prepare(
          "CREATE UNIQUE INDEX IF NOT EXISTS athlete_billing_athlete_unique ON athlete_billing (athlete_id)",
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS athlete_billing_organization_idx ON athlete_billing (organization_id)",
        ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS athlete_billing_plan_idx ON athlete_billing (plan_id)",
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
          ["guardian_document", "ALTER TABLE athletes ADD COLUMN guardian_document TEXT"],
          ["emergency_name", "ALTER TABLE athletes ADD COLUMN emergency_name TEXT"],
          ["emergency_phone", "ALTER TABLE athletes ADD COLUMN emergency_phone TEXT"],
          ["allergies", "ALTER TABLE athletes ADD COLUMN allergies TEXT"],
          ["medications", "ALTER TABLE athletes ADD COLUMN medications TEXT"],
          ["medical_notes", "ALTER TABLE athletes ADD COLUMN medical_notes TEXT"],
          [
            "image_authorized",
            "ALTER TABLE athletes ADD COLUMN image_authorized INTEGER NOT NULL DEFAULT 0",
          ],
          ["qr_token", "ALTER TABLE athletes ADD COLUMN qr_token TEXT"],
        ] as const;

        for (const [column, statement] of additions) {
          if (!existing.has(column)) {
            await d1.prepare(statement).run();
          }
        }
        await d1
          .prepare(
            "CREATE UNIQUE INDEX IF NOT EXISTS athletes_qr_token_unique ON athletes (qr_token)",
          )
          .run();

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

        const paymentColumns = await d1
          .prepare("PRAGMA table_info(payments)")
          .all<{ name: string }>();
        const existingPaymentColumns = new Set(
          paymentColumns.results.map((column) => column.name),
        );
        const paymentAdditions = [
          [
            "paid_amount_cents",
            "ALTER TABLE payments ADD COLUMN paid_amount_cents INTEGER",
          ],
          [
            "payment_method",
            "ALTER TABLE payments ADD COLUMN payment_method TEXT",
          ],
          ["plan_name", "ALTER TABLE payments ADD COLUMN plan_name TEXT"],
          ["notes", "ALTER TABLE payments ADD COLUMN notes TEXT"],
          ["external_provider", "ALTER TABLE payments ADD COLUMN external_provider TEXT"],
          ["external_payment_id", "ALTER TABLE payments ADD COLUMN external_payment_id TEXT"],
          ["invoice_url", "ALTER TABLE payments ADD COLUMN invoice_url TEXT"],
          ["bank_slip_url", "ALTER TABLE payments ADD COLUMN bank_slip_url TEXT"],
          ["external_status", "ALTER TABLE payments ADD COLUMN external_status TEXT"],
          [
            "updated_at",
            "ALTER TABLE payments ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0",
          ],
        ] as const;

        for (const [column, statement] of paymentAdditions) {
          if (!existingPaymentColumns.has(column)) {
            await d1.prepare(statement).run();
          }
        }

        const billingColumns = await d1
          .prepare("PRAGMA table_info(athlete_billing)")
          .all<{ name: string }>();
        if (!billingColumns.results.some((column) => column.name === "provider_customer_id")) {
          await d1
            .prepare("ALTER TABLE athlete_billing ADD COLUMN provider_customer_id TEXT")
            .run();
        }

        const billingPlanColumns = await d1
          .prepare("PRAGMA table_info(billing_plans)")
          .all<{ name: string }>();
        if (!billingPlanColumns.results.some((column) => column.name === "category")) {
          await d1
            .prepare("ALTER TABLE billing_plans ADD COLUMN category TEXT")
            .run();
        }

        const attendanceSessionColumns = await d1
          .prepare("PRAGMA table_info(attendance_sessions)")
          .all<{ name: string }>();
        const existingAttendanceSessionColumns = new Set(
          attendanceSessionColumns.results.map((column) => column.name),
        );
        const attendanceSessionAdditions = [
          [
            "status",
            "ALTER TABLE attendance_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'",
          ],
          ["canceled_at", "ALTER TABLE attendance_sessions ADD COLUMN canceled_at INTEGER"],
          ["canceled_by", "ALTER TABLE attendance_sessions ADD COLUMN canceled_by TEXT"],
          ["cancel_reason", "ALTER TABLE attendance_sessions ADD COLUMN cancel_reason TEXT"],
        ] as const;

        for (const [column, statement] of attendanceSessionAdditions) {
          if (!existingAttendanceSessionColumns.has(column)) {
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
