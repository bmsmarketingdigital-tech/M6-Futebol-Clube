CREATE TABLE `athlete_billing` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`athlete_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`discount_type` text DEFAULT 'none' NOT NULL,
	`discount_value` integer DEFAULT 0 NOT NULL,
	`custom_due_day` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`athlete_id`) REFERENCES `athletes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `billing_plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `athlete_billing_athlete_unique` ON `athlete_billing` (`athlete_id`);--> statement-breakpoint
CREATE INDEX `athlete_billing_organization_idx` ON `athlete_billing` (`organization_id`);--> statement-breakpoint
CREATE INDEX `athlete_billing_plan_idx` ON `athlete_billing` (`plan_id`);--> statement-breakpoint
CREATE TABLE `billing_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`due_day` integer DEFAULT 10 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `billing_plans_organization_idx` ON `billing_plans` (`organization_id`);--> statement-breakpoint
ALTER TABLE `payments` ADD `paid_amount_cents` integer;--> statement-breakpoint
ALTER TABLE `payments` ADD `payment_method` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `plan_name` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `updated_at` integer DEFAULT 0 NOT NULL;
