CREATE TABLE `athlete_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`athlete_id` text NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`athlete_id`) REFERENCES `athletes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `athlete_documents_object_key_unique` ON `athlete_documents` (`object_key`);--> statement-breakpoint
CREATE INDEX `athlete_documents_athlete_idx` ON `athlete_documents` (`organization_id`,`athlete_id`);--> statement-breakpoint
ALTER TABLE `athletes` ADD `birth_date` text;--> statement-breakpoint
ALTER TABLE `athletes` ADD `guardian_email` text;--> statement-breakpoint
ALTER TABLE `athletes` ADD `emergency_name` text;--> statement-breakpoint
ALTER TABLE `athletes` ADD `emergency_phone` text;--> statement-breakpoint
ALTER TABLE `athletes` ADD `allergies` text;--> statement-breakpoint
ALTER TABLE `athletes` ADD `medications` text;--> statement-breakpoint
ALTER TABLE `athletes` ADD `medical_notes` text;--> statement-breakpoint
ALTER TABLE `athletes` ADD `image_authorized` integer DEFAULT false NOT NULL;