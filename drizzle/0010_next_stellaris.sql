CREATE TABLE `class_reminders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` text NOT NULL,
	`team_id` text NOT NULL,
	`session_date` text NOT NULL,
	`sent_at` integer NOT NULL,
	`recipient_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `class_reminders_team_date_unique` ON `class_reminders` (`team_id`,`session_date`);--> statement-breakpoint
CREATE INDEX `class_reminders_organization_idx` ON `class_reminders` (`organization_id`);--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`reference_month` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`supplier` text,
	`amount_cents` integer NOT NULL,
	`due_date` text NOT NULL,
	`paid_at` integer,
	`payment_method` text,
	`status` text DEFAULT 'open' NOT NULL,
	`notes` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `expenses_organization_month_idx` ON `expenses` (`organization_id`,`reference_month`);--> statement-breakpoint
CREATE INDEX `expenses_organization_status_idx` ON `expenses` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `license_state` (
	`id` text PRIMARY KEY NOT NULL,
	`install_id` text NOT NULL,
	`expires_at` integer,
	`grace_days` integer DEFAULT 3 NOT NULL,
	`last_seen_at` integer NOT NULL,
	`last_issued_at` integer,
	`used_nonces` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `attendance_sessions` ADD `status` text DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE `attendance_sessions` ADD `canceled_at` integer;--> statement-breakpoint
ALTER TABLE `attendance_sessions` ADD `canceled_by` text;--> statement-breakpoint
ALTER TABLE `attendance_sessions` ADD `cancel_reason` text;--> statement-breakpoint
ALTER TABLE `billing_plans` ADD `category` text;