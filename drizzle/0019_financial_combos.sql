CREATE TABLE `billing_combos` (
  `id` text PRIMARY KEY NOT NULL, `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
  `name` text NOT NULL, `combo_type` text NOT NULL DEFAULT 'custom', `duration_months` integer NOT NULL,
  `description` text, `base_plan_id` text REFERENCES `billing_plans`(`id`), `base_amount_cents` integer NOT NULL,
  `discount_type` text NOT NULL DEFAULT 'none', `discount_value` integer NOT NULL DEFAULT 0,
  `final_amount_cents` integer NOT NULL, `billing_mode` text NOT NULL DEFAULT 'installments', `installment_count` integer NOT NULL,
  `active` integer NOT NULL DEFAULT 1, `created_at` integer NOT NULL, `updated_at` integer NOT NULL
);
CREATE INDEX `billing_combos_organization_idx` ON `billing_combos` (`organization_id`);
CREATE TABLE `athlete_combos` (
  `id` text PRIMARY KEY NOT NULL, `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
  `athlete_id` text NOT NULL REFERENCES `athletes`(`id`) ON DELETE cascade, `combo_id` text NOT NULL REFERENCES `billing_combos`(`id`),
  `combo_name_snapshot` text NOT NULL, `duration_months` integer NOT NULL, `base_amount_cents` integer NOT NULL,
  `discount_type` text NOT NULL, `discount_value` integer NOT NULL, `final_amount_cents` integer NOT NULL,
  `installment_count` integer NOT NULL, `start_date` text NOT NULL, `end_date` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active', `created_at` integer NOT NULL, `updated_at` integer NOT NULL
);
CREATE INDEX `athlete_combos_organization_idx` ON `athlete_combos` (`organization_id`);
CREATE INDEX `athlete_combos_athlete_idx` ON `athlete_combos` (`athlete_id`);
CREATE UNIQUE INDEX `athlete_combos_active_athlete_unique` ON `athlete_combos` (`athlete_id`, `start_date`);
CREATE TABLE `athlete_combo_installments` (
  `id` text PRIMARY KEY NOT NULL, `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
  `athlete_combo_id` text NOT NULL REFERENCES `athlete_combos`(`id`) ON DELETE cascade, `installment_number` integer NOT NULL,
  `installment_total` integer NOT NULL, `reference_month` text NOT NULL, `due_date` text NOT NULL, `amount_cents` integer NOT NULL,
  `payment_id` text REFERENCES `payments`(`id`), `created_at` integer NOT NULL
);
CREATE UNIQUE INDEX `athlete_combo_installment_unique` ON `athlete_combo_installments` (`athlete_combo_id`, `installment_number`);
CREATE INDEX `athlete_combo_installments_organization_idx` ON `athlete_combo_installments` (`organization_id`);
CREATE TABLE `athlete_combo_coverage` (
  `id` text PRIMARY KEY NOT NULL, `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
  `athlete_combo_id` text NOT NULL REFERENCES `athlete_combos`(`id`) ON DELETE cascade, `reference_month` text NOT NULL
);
CREATE UNIQUE INDEX `athlete_combo_coverage_unique` ON `athlete_combo_coverage` (`athlete_combo_id`, `reference_month`);
ALTER TABLE `payments` ADD COLUMN `athlete_combo_id` text REFERENCES `athlete_combos`(`id`);
ALTER TABLE `payments` ADD COLUMN `combo_installment_number` integer;
ALTER TABLE `payments` ADD COLUMN `combo_installment_total` integer;
