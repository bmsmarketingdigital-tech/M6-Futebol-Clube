CREATE TABLE `team_athletes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` text NOT NULL,
	`team_id` text NOT NULL,
	`athlete_id` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`enrolled_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`athlete_id`) REFERENCES `athletes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_athletes_team_athlete_unique` ON `team_athletes` (`team_id`,`athlete_id`);--> statement-breakpoint
CREATE INDEX `team_athletes_organization_idx` ON `team_athletes` (`organization_id`);--> statement-breakpoint
CREATE INDEX `team_athletes_athlete_idx` ON `team_athletes` (`athlete_id`);--> statement-breakpoint
ALTER TABLE `teams` ADD `schedule_days` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `start_time` text DEFAULT '08:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `end_time` text DEFAULT '09:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `place` text DEFAULT 'Campo 1' NOT NULL;