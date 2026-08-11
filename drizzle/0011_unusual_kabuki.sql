ALTER TABLE `expenses` ADD `installment_group_id` text;--> statement-breakpoint
ALTER TABLE `expenses` ADD `installment_number` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `expenses` ADD `installment_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `expenses_installment_group_idx` ON `expenses` (`organization_id`,`installment_group_id`);