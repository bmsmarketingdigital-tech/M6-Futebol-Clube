CREATE TABLE `communication_recipients` (
	`id` text PRIMARY KEY NOT NULL,
	`communication_id` text NOT NULL,
	`athlete_id` text NOT NULL,
	`guardian_name` text NOT NULL,
	`guardian_email` text,
	`guardian_phone` text,
	`read_at` integer,
	FOREIGN KEY (`communication_id`) REFERENCES `communications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`athlete_id`) REFERENCES `athletes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `communication_recipients_message_athlete_unique` ON `communication_recipients` (`communication_id`,`athlete_id`);--> statement-breakpoint
CREATE INDEX `communication_recipients_message_idx` ON `communication_recipients` (`communication_id`);--> statement-breakpoint
CREATE TABLE `communications` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`audience_type` text NOT NULL,
	`team_id` text,
	`priority` text DEFAULT 'normal' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`scheduled_at` text,
	`sent_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `communications_organization_status_idx` ON `communications` (`organization_id`,`status`);