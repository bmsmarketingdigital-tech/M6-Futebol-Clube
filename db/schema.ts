import { index, integer, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const localUsers = sqliteTable("local_users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const organizationMembers = sqliteTable(
  "organization_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => localUsers.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: ["owner", "admin", "coach", "finance"] })
      .notNull()
      .default("owner"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("organization_members_org_user_unique").on(
      table.organizationId,
      table.userId,
    ),
    index("organization_members_user_idx").on(table.userId),
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
    status: text("status", { enum: ["completed", "canceled"] })
      .notNull()
      .default("completed"),
    canceledAt: integer("canceled_at", { mode: "timestamp" }),
    canceledBy: text("canceled_by"),
    cancelReason: text("cancel_reason"),
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

export const classReminders = sqliteTable(
  "class_reminders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    sessionDate: text("session_date").notNull(),
    sentAt: integer("sent_at", { mode: "timestamp" }).notNull(),
    recipientCount: integer("recipient_count").notNull().default(0),
  },
  (table) => [
    uniqueIndex("class_reminders_team_date_unique").on(
      table.teamId,
      table.sessionDate,
    ),
    index("class_reminders_organization_idx").on(table.organizationId),
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
    externalCreationStatus: text("external_creation_status", {
      enum: ["creating", "created", "failed", "unknown"],
    }),
    externalCreationToken: text("external_creation_token"),
    externalCreationStartedAt: integer("external_creation_started_at", { mode: "timestamp" }),
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
    uniqueIndex("payments_external_payment_unique").on(table.externalPaymentId),
  ],
);

export const paymentTransactions = sqliteTable(
  "payment_transactions",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["payment", "refund", "opening_balance"],
    }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    paymentMethod: text("payment_method", {
      enum: ["cash", "pix", "card", "bank", "other"],
    }),
    origin: text("origin", {
      enum: ["manual", "asaas", "migration", "system"],
    }).notNull(),
    occurredAt: integer("occurred_at", { mode: "timestamp" }).notNull(),
    createdBy: text("created_by"),
    externalTransactionId: text("external_transaction_id"),
    reversesTransactionId: text("reverses_transaction_id").references(
      (): AnySQLiteColumn => paymentTransactions.id,
      { onDelete: "restrict" },
    ),
    idempotencyKey: text("idempotency_key").notNull(),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("payment_transactions_idempotency_unique").on(table.idempotencyKey),
    uniqueIndex("payment_transactions_external_unique").on(
      table.origin,
      table.externalTransactionId,
      table.type,
    ),
    index("payment_transactions_payment_date_idx").on(table.paymentId, table.occurredAt),
    index("payment_transactions_reversal_idx").on(table.reversesTransactionId),
  ],
);

export const billingNotificationSettings = sqliteTable(
  "billing_notification_settings",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    beforeDueEnabled: integer("before_due_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    beforeDueDays: integer("before_due_days").notNull().default(3),
    dueTodayEnabled: integer("due_today_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    overdueEnabled: integer("overdue_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    overdueDays: integer("overdue_days").notNull().default(5),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
);

export const billingNotifications = sqliteTable(
  "billing_notifications",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    athleteId: text("athlete_id")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["before_due", "due_today", "overdue"],
    }).notNull(),
    phone: text("phone").notNull(),
    message: text("message").notNull(),
    status: text("status", {
      enum: ["sent", "failed"],
    }).notNull(),
    error: text("error"),
    sentAt: integer("sent_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("billing_notifications_payment_type_unique").on(
      table.paymentId,
      table.type,
    ),
    index("billing_notifications_organization_status_idx").on(
      table.organizationId,
      table.status,
    ),
  ],
);

export const notificationOutbox = sqliteTable(
  "notification_outbox",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    athleteId: text("athlete_id")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    paymentId: text("payment_id").references(() => payments.id, {
      onDelete: "set null",
    }),
    teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
    legacyNotificationId: text("legacy_notification_id"),
    originalNotificationId: text("original_notification_id"),
    eventType: text("event_type", {
      enum: ["before_due", "due_today", "overdue", "enrollment", "controlled_test"],
    }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    phone: text("phone").notNull(),
    message: text("message").notNull(),
    status: text("status", {
      enum: ["pending", "processing", "sent", "failed", "delivery_unknown", "superseded"],
    }).notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp" }),
    lockedAt: integer("locked_at", { mode: "timestamp" }),
    lockedUntil: integer("locked_until", { mode: "timestamp" }),
    lockToken: text("lock_token"),
    lastError: text("last_error"),
    sentAt: integer("sent_at", { mode: "timestamp" }),
    providerMessageId: text("provider_message_id"),
    lastAttemptOrigin: text("last_attempt_origin", {
      enum: ["startup", "reconnect", "automatic", "verify_now", "enrollment", "controlled_test", "manual"],
    }),
    manualResendCount: integer("manual_resend_count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("notification_outbox_idempotency_unique").on(table.idempotencyKey),
    index("notification_outbox_eligible_idx").on(
      table.organizationId,
      table.status,
      table.nextAttemptAt,
    ),
    index("notification_outbox_original_idx").on(table.originalNotificationId),
  ],
);

export const notificationAttempts = sqliteTable(
  "notification_attempts",
  {
    id: text("id").primaryKey(),
    notificationId: text("notification_id")
      .notNull()
      .references(() => notificationOutbox.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    origin: text("origin").notNull(),
    lockToken: text("lock_token").notNull(),
    status: text("status").notNull(),
    error: text("error"),
    providerMessageId: text("provider_message_id"),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp" }),
  },
  (table) => [
    uniqueIndex("notification_attempts_lock_token_unique").on(table.lockToken),
    index("notification_attempts_notification_idx").on(
      table.notificationId,
      table.startedAt,
    ),
  ],
);

export const expenses = sqliteTable(
  "expenses",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    referenceMonth: text("reference_month").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    supplier: text("supplier"),
    amountCents: integer("amount_cents").notNull(),
    dueDate: text("due_date").notNull(),
    paidAt: integer("paid_at", { mode: "timestamp" }),
    paymentMethod: text("payment_method", {
      enum: ["cash", "pix", "card", "bank", "other"],
    }),
    status: text("status", {
      enum: ["open", "paid", "overdue", "cancelled"],
    })
      .notNull()
      .default("open"),
    notes: text("notes"),
    installmentGroupId: text("installment_group_id"),
    installmentNumber: integer("installment_number").notNull().default(1),
    installmentCount: integer("installment_count").notNull().default(1),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("expenses_organization_month_idx").on(
      table.organizationId,
      table.referenceMonth,
    ),
    index("expenses_organization_status_idx").on(
      table.organizationId,
      table.status,
    ),
    index("expenses_installment_group_idx").on(
      table.organizationId,
      table.installmentGroupId,
    ),
  ],
);

export const licenseState = sqliteTable("license_state", {
  id: text("id").primaryKey(),
  installId: text("install_id").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  graceDays: integer("grace_days").notNull().default(3),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull(),
  lastIssuedAt: integer("last_issued_at", { mode: "timestamp" }),
  usedNonces: text("used_nonces").notNull().default("[]"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
