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

export const sportsCategories = sqliteTable(
  "sports_categories",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("sports_categories_org_name_unique").on(
      table.organizationId,
      table.name,
    ),
    index("sports_categories_org_order_idx").on(
      table.organizationId,
      table.sortOrder,
    ),
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
    birthDate: text("birth_date"),
    category: text("category").notNull(),
    guardianName: text("guardian_name").notNull(),
    guardianDocument: text("guardian_document"),
    guardianPhone: text("guardian_phone"),
    guardianEmail: text("guardian_email"),
    emergencyName: text("emergency_name"),
    emergencyPhone: text("emergency_phone"),
    allergies: text("allergies"),
    medications: text("medications"),
    medicalNotes: text("medical_notes"),
    imageAuthorized: integer("image_authorized", { mode: "boolean" })
      .notNull()
      .default(false),
    attendanceRate: integer("attendance_rate").notNull().default(100),
    financialStatus: text("financial_status", {
      enum: ["paid", "pending"],
    })
      .notNull()
      .default("paid"),
    qrToken: text("qr_token"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("athletes_organization_idx").on(table.organizationId),
    index("athletes_name_idx").on(table.organizationId, table.fullName),
    index("athletes_category_idx").on(table.organizationId, table.category),
    uniqueIndex("athletes_qr_token_unique").on(table.qrToken),
  ],
);

export const athleteDocuments = sqliteTable(
  "athlete_documents",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    athleteId: text("athlete_id")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull().unique(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    kind: text("kind", {
      enum: ["identity", "medical", "authorization", "other"],
    })
      .notNull()
      .default("other"),
    uploadedBy: text("uploaded_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("athlete_documents_athlete_idx").on(
      table.organizationId,
      table.athleteId,
    ),
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
    scheduleDays: text("schedule_days").notNull().default("[]"),
    startTime: text("start_time").notNull().default("08:00"),
    endTime: text("end_time").notNull().default("09:00"),
    place: text("place").notNull().default("Campo 1"),
    capacity: integer("capacity").notNull().default(24),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("teams_organization_idx").on(table.organizationId)],
);

export const teamAthletes = sqliteTable(
  "team_athletes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    athleteId: text("athlete_id")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    enrolledAt: integer("enrolled_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("team_athletes_team_athlete_unique").on(
      table.teamId,
      table.athleteId,
    ),
    index("team_athletes_organization_idx").on(table.organizationId),
    index("team_athletes_athlete_idx").on(table.athleteId),
  ],
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

export const athleteCheckIns = sqliteTable(
  "athlete_check_ins",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    athleteId: text("athlete_id")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    attendanceSessionId: text("attendance_session_id")
      .notNull()
      .references(() => attendanceSessions.id, { onDelete: "cascade" }),
    scannedAt: integer("scanned_at", { mode: "timestamp" }).notNull(),
    scannedBy: text("scanned_by").notNull(),
    guardianPhone: text("guardian_phone"),
    notificationMessage: text("notification_message").notNull(),
    notificationStatus: text("notification_status", {
      enum: ["pending", "sent", "failed", "skipped"],
    })
      .notNull()
      .default("pending"),
    notificationError: text("notification_error"),
    notifiedAt: integer("notified_at", { mode: "timestamp" }),
  },
  (table) => [
    index("athlete_check_ins_org_date_idx").on(
      table.organizationId,
      table.scannedAt,
    ),
    index("athlete_check_ins_athlete_date_idx").on(
      table.athleteId,
      table.scannedAt,
    ),
    index("athlete_check_ins_notification_idx").on(
      table.organizationId,
      table.notificationStatus,
    ),
  ],
);

export const athleteEvaluations = sqliteTable(
  "athlete_evaluations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    athleteId: text("athlete_id")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    evaluationDate: text("evaluation_date").notNull(),
    technicalScore: integer("technical_score").notNull(),
    physicalScore: integer("physical_score").notNull(),
    tacticalScore: integer("tactical_score").notNull(),
    behavioralScore: integer("behavioral_score").notNull(),
    strengths: text("strengths"),
    improvements: text("improvements"),
    nextGoals: text("next_goals"),
    evaluatedBy: text("evaluated_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("athlete_evaluations_organization_idx").on(table.organizationId),
    index("athlete_evaluations_athlete_date_idx").on(
      table.athleteId,
      table.evaluationDate,
    ),
  ],
);

export const trainingSessions = sqliteTable(
  "training_sessions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id),
    title: text("title").notNull(),
    objective: text("objective").notNull(),
    sessionDate: text("session_date").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    status: text("status", { enum: ["planned", "completed", "cancelled"] })
      .notNull()
      .default("planned"),
    notes: text("notes"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("training_sessions_organization_date_idx").on(
      table.organizationId,
      table.sessionDate,
    ),
    index("training_sessions_team_idx").on(table.teamId),
  ],
);

export const trainingDrills = sqliteTable(
  "training_drills",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => trainingSessions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    focus: text("focus"),
    durationMinutes: integer("duration_minutes").notNull(),
    description: text("description"),
  },
  (table) => [
    index("training_drills_session_position_idx").on(
      table.sessionId,
      table.position,
    ),
  ],
);

export const communications = sqliteTable(
  "communications",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    message: text("message").notNull(),
    audienceType: text("audience_type", { enum: ["all", "team"] }).notNull(),
    teamId: text("team_id").references(() => teams.id),
    priority: text("priority", { enum: ["normal", "important", "urgent"] })
      .notNull()
      .default("normal"),
    status: text("status", { enum: ["draft", "scheduled", "sent", "cancelled"] })
      .notNull()
      .default("draft"),
    scheduledAt: text("scheduled_at"),
    sentAt: integer("sent_at", { mode: "timestamp" }),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("communications_organization_status_idx").on(
      table.organizationId,
      table.status,
    ),
  ],
);

export const communicationRecipients = sqliteTable(
  "communication_recipients",
  {
    id: text("id").primaryKey(),
    communicationId: text("communication_id")
      .notNull()
      .references(() => communications.id, { onDelete: "cascade" }),
    athleteId: text("athlete_id")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    guardianName: text("guardian_name").notNull(),
    guardianEmail: text("guardian_email"),
    guardianPhone: text("guardian_phone"),
    readAt: integer("read_at", { mode: "timestamp" }),
  },
  (table) => [
    uniqueIndex("communication_recipients_message_athlete_unique").on(
      table.communicationId,
      table.athleteId,
    ),
    index("communication_recipients_message_idx").on(table.communicationId),
  ],
);

export const billingPlans = sqliteTable(
  "billing_plans",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    amountCents: integer("amount_cents").notNull(),
    dueDay: integer("due_day").notNull().default(10),
    category: text("category"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("billing_plans_organization_idx").on(table.organizationId),
  ],
);

export const athleteBilling = sqliteTable(
  "athlete_billing",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    athleteId: text("athlete_id")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => billingPlans.id),
    discountType: text("discount_type", {
      enum: ["none", "fixed", "percent"],
    })
      .notNull()
      .default("none"),
    discountValue: integer("discount_value").notNull().default(0),
    customDueDay: integer("custom_due_day"),
    providerCustomerId: text("provider_customer_id"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("athlete_billing_athlete_unique").on(table.athleteId),
    index("athlete_billing_organization_idx").on(table.organizationId),
    index("athlete_billing_plan_idx").on(table.planId),
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
    paidAmountCents: integer("paid_amount_cents"),
    paymentMethod: text("payment_method", {
      enum: ["cash", "pix", "card", "bank", "other"],
    }),
    planName: text("plan_name"),
    notes: text("notes"),
    externalProvider: text("external_provider"),
    externalPaymentId: text("external_payment_id"),
    invoiceUrl: text("invoice_url"),
    bankSlipUrl: text("bank_slip_url"),
    externalStatus: text("external_status"),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    status: text("status", {
      enum: ["open", "paid", "partial", "overdue", "cancelled"],
    })
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
