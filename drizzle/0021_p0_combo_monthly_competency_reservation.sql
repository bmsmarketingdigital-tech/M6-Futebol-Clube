CREATE TEMP TABLE `_combo_month_conflict_guard` (
  `conflict_count` integer NOT NULL CHECK (`conflict_count` = 0)
);--> statement-breakpoint
INSERT INTO `_combo_month_conflict_guard` (`conflict_count`)
SELECT COUNT(*)
FROM `athlete_combo_coverage` c
INNER JOIN `payments` p
  ON p.`organization_id` = c.`organization_id`
  AND p.`athlete_id` = c.`athlete_id`
  AND p.`reference_month` = c.`reference_month`
  AND p.`athlete_combo_id` IS NULL
WHERE c.`active` = 1;--> statement-breakpoint
DROP TABLE `_combo_month_conflict_guard`;--> statement-breakpoint
CREATE TABLE `athlete_billing_month_reservations` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
  `athlete_id` text NOT NULL REFERENCES `athletes`(`id`) ON DELETE cascade,
  `reference_month` text NOT NULL,
  `source_type` text NOT NULL CHECK (`source_type` IN ('monthly','combo')),
  `source_id` text NOT NULL,
  `created_at` integer NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `athlete_billing_month_reservation_unique`
ON `athlete_billing_month_reservations` (`organization_id`,`athlete_id`,`reference_month`);--> statement-breakpoint
CREATE INDEX `athlete_billing_month_reservation_source_idx`
ON `athlete_billing_month_reservations` (`source_type`,`source_id`);--> statement-breakpoint
INSERT INTO `athlete_billing_month_reservations`
  (`id`,`organization_id`,`athlete_id`,`reference_month`,`source_type`,`source_id`,`created_at`)
SELECT
  'monthly:' || p.`id`,p.`organization_id`,p.`athlete_id`,p.`reference_month`,'monthly',p.`id`,p.`created_at`
FROM `payments` p
WHERE p.`athlete_combo_id` IS NULL;--> statement-breakpoint
INSERT INTO `athlete_billing_month_reservations`
  (`id`,`organization_id`,`athlete_id`,`reference_month`,`source_type`,`source_id`,`created_at`)
SELECT
  'combo:' || c.`id`,c.`organization_id`,c.`athlete_id`,c.`reference_month`,'combo',c.`athlete_combo_id`,c.`created_at`
FROM `athlete_combo_coverage` c
WHERE c.`active` = 1;
