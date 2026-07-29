CREATE TABLE `athlete_evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`athlete_id` text NOT NULL,
	`evaluation_date` text NOT NULL,
	`technical_score` integer NOT NULL,
	`physical_score` integer NOT NULL,
	`tactical_score` integer NOT NULL,
	`behavioral_score` integer NOT NULL,
	`strengths` text,
	`improvements` text,
	`next_goals` text,
	`evaluated_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`athlete_id`) REFERENCES `athletes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `athlete_evaluations_organization_idx` ON `athlete_evaluations` (`organization_id`);--> statement-breakpoint
CREATE INDEX `athlete_evaluations_athlete_date_idx` ON `athlete_evaluations` (`athlete_id`,`evaluation_date`);