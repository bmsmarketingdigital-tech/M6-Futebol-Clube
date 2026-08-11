import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import { HISTORY_PROTECTION_TRIGGER_SQL } from "./history-protection-triggers";
import { NOTIFICATION_HISTORY_TRIGGER_SQL } from "./notification-history-triggers";
import { PAYMENT_TRANSACTION_TRIGGER_SQL } from "./payment-transaction-triggers";

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
        d1.prepare(`CREATE TABLE IF NOT EXISTS local_users (
          id TEXT PRIMARY KEY NOT NULL,
          username TEXT NOT NULL UNIQUE,
          email TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'admin',
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`),
        d1.prepare(`CREATE TABLE IF NOT EXISTS local_auth_sessions (
          token_hash TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES local_users(id) ON DELETE CASCADE,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )`),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS local_auth_sessions_user_idx ON local_auth_sessions (user_id)",
        ),
        d1.prepare(`CREATE TABLE IF NOT EXISTS license_state (
          id TEXT PRIMARY KEY NOT NULL,
          install_id TEXT NOT NULL,
          expires_at INTEGER,
          grace_days INTEGER NOT NULL DEFAULT 3,
          last_seen_at INTEGER NOT NULL,
          last_issued_at INTEGER,
          used_nonces TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
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
      d1.prepare(`CREATE TABLE IF NOT EXISTS billing_notification_settings (
        organization_id TEXT PRIMARY KEY NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL DEFAULT 1,
        before_due_enabled INTEGER NOT NULL DEFAULT 1,
        before_due_days INTEGER NOT NULL DEFAULT 3,
        due_today_enabled INTEGER NOT NULL DEFAULT 1,
        overdue_enabled INTEGER NOT NULL DEFAULT 1,
        overdue_days INTEGER NOT NULL DEFAULT 5,
        updated_at INTEGER NOT NULL
      )`),
      d1.prepare(`CREATE TABLE IF NOT EXISTS billing_notifications (
        id TEXT PRIMARY KEY NOT NULL,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
        athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        phone TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        sent_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`),
      d1.prepare(`CREATE TABLE IF NOT EXISTS notification_outbox (
        id TEXT PRIMARY KEY NOT NULL,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
        payment_id TEXT REFERENCES payments(id) ON DELETE SET NULL,
        team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
        legacy_notification_id TEXT,
        original_notification_id TEXT,
        event_type TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        phone TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        next_attempt_at INTEGER,
        locked_at INTEGER,
        locked_until INTEGER,
        lock_token TEXT,
        last_error TEXT,
        sent_at INTEGER,
        provider_message_id TEXT,
        last_attempt_origin TEXT,
        manual_resend_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`),
      d1.prepare(`CREATE TABLE IF NOT EXISTS notification_attempts (
        id TEXT PRIMARY KEY NOT NULL,
        notification_id TEXT NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,
        attempt_number INTEGER NOT NULL,
        origin TEXT NOT NULL,
        lock_token TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        provider_message_id TEXT,
        started_at INTEGER NOT NULL,
        finished_at INTEGER
      )`),
      d1.prepare(`CREATE TABLE IF NOT EXISTS payment_transactions (
        id TEXT PRIMARY KEY NOT NULL,
        payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('payment','refund','opening_balance')),
        amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
        payment_method TEXT,
        origin TEXT NOT NULL CHECK(origin IN ('manual','asaas','migration','system')),
        occurred_at INTEGER NOT NULL,
        created_by TEXT,
        external_transaction_id TEXT,
        reverses_transaction_id TEXT REFERENCES payment_transactions(id) ON DELETE RESTRICT,
        idempotency_key TEXT NOT NULL,
        note TEXT,
        created_at INTEGER NOT NULL
      )`),
      d1.prepare(`CREATE TABLE IF NOT EXISTS expenses (
          id TEXT PRIMARY KEY NOT NULL,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          reference_month TEXT NOT NULL,
          description TEXT NOT NULL,
          category TEXT NOT NULL,
          supplier TEXT,
          amount_cents INTEGER NOT NULL,
          due_date TEXT NOT NULL,
          paid_at INTEGER,
          payment_method TEXT,
          status TEXT NOT NULL DEFAULT 'open',
          notes TEXT,
          installment_group_id TEXT,
          installment_number INTEGER NOT NULL DEFAULT 1,
          installment_count INTEGER NOT NULL DEFAULT 1,
          created_by TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
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
      d1.prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS billing_notifications_payment_type_unique ON billing_notifications (payment_id, type)",
      ),
      d1.prepare(
        "CREATE INDEX IF NOT EXISTS billing_notifications_organization_status_idx ON billing_notifications (organization_id, status)",
      ),
      d1.prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS notification_outbox_idempotency_unique ON notification_outbox (idempotency_key)",
      ),
      d1.prepare(
        "CREATE INDEX IF NOT EXISTS notification_outbox_eligible_idx ON notification_outbox (organization_id, status, next_attempt_at)",
      ),
      d1.prepare(
        "CREATE INDEX IF NOT EXISTS notification_outbox_original_idx ON notification_outbox (original_notification_id)",
      ),
      d1.prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS notification_attempts_lock_token_unique ON notification_attempts (lock_token)",
      ),
      d1.prepare(
        "CREATE INDEX IF NOT EXISTS notification_attempts_notification_idx ON notification_attempts (notification_id, started_at)",
      ),
      d1.prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_idempotency_unique ON payment_transactions (idempotency_key)",
      ),
      d1.prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_external_unique ON payment_transactions (origin, external_transaction_id, type) WHERE external_transaction_id IS NOT NULL",
      ),
      d1.prepare(
        "CREATE INDEX IF NOT EXISTS payment_transactions_payment_date_idx ON payment_transactions (payment_id, occurred_at)",
      ),
      d1.prepare(
        "CREATE INDEX IF NOT EXISTS payment_transactions_reversal_idx ON payment_transactions (reverses_transaction_id)",
      ),
      d1.prepare(
        "CREATE INDEX IF NOT EXISTS expenses_organization_month_idx ON expenses (organization_id, reference_month)",
      ),
        d1.prepare(
          "CREATE INDEX IF NOT EXISTS expenses_organization_status_idx ON expenses (organization_id, status)",
        ),
      ])
      .then(async () => {
        await d1.batch(
          [
            ...PAYMENT_TRANSACTION_TRIGGER_SQL,
            ...HISTORY_PROTECTION_TRIGGER_SQL,
            ...NOTIFICATION_HISTORY_TRIGGER_SQL,
          ].map(
            (statement) => d1.prepare(statement),
          ),
        );
        await d1
          .prepare(`INSERT INTO notification_outbox (
              id, organization_id, athlete_id, payment_id,
              legacy_notification_id, event_type, idempotency_key,
              phone, message, status, attempt_count, max_attempts,
              last_error, sent_at, last_attempt_origin, created_at, updated_at
            )
            SELECT
              'legacy:' || id, organization_id, athlete_id, payment_id,
              id, type, 'billing:' || payment_id || ':' || type,
              phone, message, status,
              CASE WHEN status = 'failed' THEN 3 ELSE 1 END,
              3, error, sent_at, 'automatic', created_at, updated_at
            FROM billing_notifications
            WHERE 1
            ON CONFLICT(idempotency_key) DO NOTHING`)
          .run();

        const localUserColumns = await d1
          .prepare("PRAGMA table_info(local_users)")
          .all<{ name: string }>();
        const existingLocalUserColumns = new Set(
          localUserColumns.results.map((column) => column.name),
        );
        if (!existingLocalUserColumns.has("username")) {
          await d1.prepare("ALTER TABLE local_users ADD COLUMN username TEXT").run();
          await d1
            .prepare(
              `UPDATE local_users
               SET username = CASE
                 WHEN instr(email, '@') > 1 THEN substr(email, 1, instr(email, '@') - 1)
                 ELSE lower(replace(display_name, ' ', '.'))
               END
               WHERE username IS NULL OR username = ''`,
            )
            .run();
        }
        if (!existingLocalUserColumns.has("role")) {
          await d1
            .prepare("ALTER TABLE local_users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'")
            .run();
        }
        await d1
          .prepare(
            "CREATE UNIQUE INDEX IF NOT EXISTS local_users_username_unique ON local_users (username)",
          )
          .run();

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
          ["external_creation_status", "ALTER TABLE payments ADD COLUMN external_creation_status TEXT"],
          ["external_creation_token", "ALTER TABLE payments ADD COLUMN external_creation_token TEXT"],
          ["external_creation_started_at", "ALTER TABLE payments ADD COLUMN external_creation_started_at INTEGER"],
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
        await d1
          .prepare("CREATE UNIQUE INDEX IF NOT EXISTS payments_external_payment_unique ON payments (external_payment_id) WHERE external_payment_id IS NOT NULL")
          .run();

        const expenseColumns = await d1
          .prepare("PRAGMA table_info(expenses)")
          .all<{ name: string }>();
        const existingExpenseColumns = new Set(
          expenseColumns.results.map((column) => column.name),
        );
        const expenseAdditions = [
          ["installment_group_id", "ALTER TABLE expenses ADD COLUMN installment_group_id TEXT"],
          [
            "installment_number",
            "ALTER TABLE expenses ADD COLUMN installment_number INTEGER NOT NULL DEFAULT 1",
          ],
          [
            "installment_count",
            "ALTER TABLE expenses ADD COLUMN installment_count INTEGER NOT NULL DEFAULT 1",
          ],
        ] as const;
        for (const [column, statement] of expenseAdditions) {
          if (!existingExpenseColumns.has(column)) {
            await d1.prepare(statement).run();
          }
        }
        await d1
          .prepare(
            "CREATE INDEX IF NOT EXISTS expenses_installment_group_idx ON expenses (organization_id, installment_group_id)",
          )
          .run();

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

        // Repara cadastros antigos feitos antes de o formulário oferecer a turma.
        // A associação automática só é segura quando existe uma única turma
        // ativa da categoria dentro da organização.
        await d1
          .prepare(`INSERT INTO team_athletes (
              organization_id, team_id, athlete_id, active, enrolled_at
            )
            SELECT
              athletes.organization_id,
              MIN(teams.id),
              athletes.id,
              1,
              unixepoch()
            FROM athletes
            INNER JOIN teams
              ON teams.organization_id = athletes.organization_id
              AND teams.category = athletes.category
              AND teams.active = 1
            WHERE athletes.active = 1
              AND NOT EXISTS (
                SELECT 1
                FROM team_athletes
                WHERE team_athletes.organization_id = athletes.organization_id
                  AND team_athletes.athlete_id = athletes.id
                  AND team_athletes.active = 1
              )
            GROUP BY athletes.organization_id, athletes.id
            HAVING COUNT(teams.id) = 1
            ON CONFLICT(team_id, athlete_id)
            DO UPDATE SET active = 1`)
          .run();
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
      .slice(0, 30) || "escola-m6";
  const now = new Date();

  await db.insert(schema.organizations).values({
    id: organizationId,
    name: "Escola de Futebol M6 Futebol Clube",
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
