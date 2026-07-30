CREATE TABLE `sports_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sports_categories_org_name_unique` ON `sports_categories` (`organization_id`,`name`);--> statement-breakpoint
CREATE INDEX `sports_categories_org_order_idx` ON `sports_categories` (`organization_id`,`sort_order`);