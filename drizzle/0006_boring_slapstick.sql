CREATE TABLE `training_drills` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`focus` text,
	`duration_minutes` integer NOT NULL,
	`description` text,
	FOREIGN KEY (`session_id`) REFERENCES `training_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `training_drills_session_position_idx` ON `training_drills` (`session_id`,`position`);--> statement-breakpoint
CREATE TABLE `training_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`team_id` text NOT NULL,
	`title` text NOT NULL,
	`objective` text NOT NULL,
	`session_date` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`notes` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `training_sessions_organization_date_idx` ON `training_sessions` (`organization_id`,`session_date`);--> statement-breakpoint
CREATE INDEX `training_sessions_team_idx` ON `training_sessions` (`team_id`);