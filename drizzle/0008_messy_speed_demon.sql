CREATE TABLE `athlete_check_ins` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`athlete_id` text NOT NULL,
	`team_id` text NOT NULL,
	`attendance_session_id` text NOT NULL,
	`scanned_at` integer NOT NULL,
	`scanned_by` text NOT NULL,
	`guardian_phone` text,
	`notification_message` text NOT NULL,
	`notification_status` text DEFAULT 'pending' NOT NULL,
	`notification_error` text,
	`notified_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`athlete_id`) REFERENCES `athletes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attendance_session_id`) REFERENCES `attendance_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `athlete_check_ins_org_date_idx` ON `athlete_check_ins` (`organization_id`,`scanned_at`);--> statement-breakpoint
CREATE INDEX `athlete_check_ins_athlete_date_idx` ON `athlete_check_ins` (`athlete_id`,`scanned_at`);--> statement-breakpoint
CREATE INDEX `athlete_check_ins_notification_idx` ON `athlete_check_ins` (`organization_id`,`notification_status`);--> statement-breakpoint
ALTER TABLE `athletes` ADD `qr_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `athletes_qr_token_unique` ON `athletes` (`qr_token`);