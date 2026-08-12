PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `athlete_combo_coverage_new` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
  `athlete_id` text NOT NULL REFERENCES `athletes`(`id`) ON DELETE cascade,
  `athlete_combo_id` text NOT NULL REFERENCES `athlete_combos`(`id`) ON DELETE cascade,
  `reference_month` text NOT NULL,
  `active` integer NOT NULL DEFAULT 1,
  `created_at` integer NOT NULL,
  `released_at` integer
);--> statement-breakpoint
INSERT INTO `athlete_combo_coverage_new` (`id`,`organization_id`,`athlete_id`,`athlete_combo_id`,`reference_month`,`active`,`created_at`,`released_at`)
SELECT c.`id`,c.`organization_id`,a.`athlete_id`,c.`athlete_combo_id`,c.`reference_month`,1,a.`created_at`,NULL
FROM `athlete_combo_coverage` c
INNER JOIN `athlete_combos` a ON a.`id`=c.`athlete_combo_id` AND a.`organization_id`=c.`organization_id`;--> statement-breakpoint
DROP TABLE `athlete_combo_coverage`;--> statement-breakpoint
ALTER TABLE `athlete_combo_coverage_new` RENAME TO `athlete_combo_coverage`;--> statement-breakpoint
CREATE UNIQUE INDEX `athlete_combo_coverage_contract_month_unique` ON `athlete_combo_coverage` (`athlete_combo_id`,`reference_month`);--> statement-breakpoint
CREATE UNIQUE INDEX `athlete_combo_coverage_active_unique` ON `athlete_combo_coverage` (`organization_id`,`athlete_id`,`reference_month`) WHERE `active`=1;--> statement-breakpoint
PRAGMA foreign_keys=ON;
