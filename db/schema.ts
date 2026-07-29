import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const organizationMembers = sqliteTable(
  "organization_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: ["owner", "admin", "coach", "finance"] })
      .notNull()
      .default("owner"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("organization_members_org_email_unique").on(
      table.organizationId,
      table.email,
    ),
    index("organization_members_email_idx").on(table.email),
  ],
);

export const athletes = sqliteTable(
  "athletes",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    birthYear: integer("birth_year").notNull(),
    category: text("category").notNull(),
    guardianName: text("guardian_name").notNull(),
    guardianPhone: text("guardian_phone"),
    attendanceRate: integer("attendance_rate").notNull().default(100),
    financialStatus: text("financial_status", {
      enum: ["paid", "pending"],
    })
      .notNull()
      .default("paid"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("athletes_organization_idx").on(table.organizationId),
    index("athletes_name_idx").on(table.organizationId, table.fullName),
    index("athletes_category_idx").on(table.organizationId, table.category),
  ],
);

export const teams = sqliteTable(
  "teams",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category").notNull(),
    coachName: text("coach_name"),
    capacity: integer("capacity").notNull().default(24),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("teams_organization_idx").on(table.organizationId)],
);

export const attendanceSessions = sqliteTable(
  "attendance_sessions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    sessionDate: text("session_date").notNull(),
    recordedBy: text("recorded_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("attendance_sessions_team_date_unique").on(
      table.teamId,
      table.sessionDate,
    ),
    index("attendance_sessions_organization_idx").on(table.organizationId),
  ],
);

export const attendanceRecords = sqliteTable(
  "attendance_records",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => attendanceSessions.id, { onDelete: "cascade" }),
    athleteId: text("athlete_id")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    present: integer("present", { mode: "boolean" }).notNull().default(true),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("attendance_records_session_athlete_unique").on(
      table.sessionId,
      table.athleteId,
    ),
  ],
);

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    athleteId: text("athlete_id")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    referenceMonth: text("reference_month").notNull(),
    amountCents: integer("amount_cents").notNull(),
    dueDate: text("due_date").notNull(),
    paidAt: integer("paid_at", { mode: "timestamp" }),
    status: text("status", { enum: ["open", "paid", "overdue", "cancelled"] })
      .notNull()
      .default("open"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("payments_athlete_month_unique").on(
      table.athleteId,
      table.referenceMonth,
    ),
    index("payments_organization_status_idx").on(
      table.organizationId,
      table.status,
    ),
  ],
);
