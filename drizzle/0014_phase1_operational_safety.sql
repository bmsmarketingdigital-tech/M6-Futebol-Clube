ALTER TABLE `payments` ADD COLUMN `external_creation_status` text;
--> statement-breakpoint
ALTER TABLE `payments` ADD COLUMN `external_creation_token` text;
--> statement-breakpoint
ALTER TABLE `payments` ADD COLUMN `external_creation_started_at` integer;
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_external_payment_unique`
ON `payments` (`external_payment_id`) WHERE `external_payment_id` IS NOT NULL;
--> statement-breakpoint
UPDATE `notification_outbox` SET
  `created_at` = `created_at` / 1000,
  `updated_at` = `updated_at` / 1000,
  `sent_at` = CASE WHEN `sent_at` IS NULL THEN NULL ELSE `sent_at` / 1000 END,
  `locked_at` = CASE WHEN `locked_at` IS NULL THEN NULL ELSE `locked_at` / 1000 END,
  `locked_until` = CASE WHEN `locked_until` IS NULL THEN NULL ELSE `locked_until` / 1000 END,
  `next_attempt_at` = CASE WHEN `next_attempt_at` IS NULL THEN NULL ELSE `next_attempt_at` / 1000 END
WHERE `id` IN (
  '81e73c42-c16f-421c-a298-b6be52adb2ac',
  '72fbc3bd-1aeb-4558-adf6-15b72c77ec03'
);
--> statement-breakpoint
UPDATE `notification_attempts` SET
  `started_at` = `started_at` / 1000,
  `finished_at` = CASE WHEN `finished_at` IS NULL THEN NULL ELSE `finished_at` / 1000 END
WHERE `id` IN (
  'c08ae75c-aefb-4c7d-afd7-c7629afcab3f',
  'ef5c2cd5-f5cb-4a33-b8f4-51e5f65dc194'
);
