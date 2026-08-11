CREATE TABLE `billing_notification_settings` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`before_due_enabled` integer DEFAULT true NOT NULL,
	`before_due_days` integer DEFAULT 3 NOT NULL,
	`due_today_enabled` integer DEFAULT true NOT NULL,
	`overdue_enabled` integer DEFAULT true NOT NULL,
	`overdue_days` integer DEFAULT 5 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `billing_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`payment_id` text NOT NULL,
	`athlete_id` text NOT NULL,
	`type` text NOT NULL,
	`phone` text NOT NULL,
	`message` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`sent_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`athlete_id`) REFERENCES `athletes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_notifications_payment_type_unique` ON `billing_notifications` (`payment_id`,`type`);--> statement-breakpoint
CREATE INDEX `billing_notifications_organization_status_idx` ON `billing_notifications` (`organization_id`,`status`);