DROP INDEX IF EXISTS `payments_athlete_month_unique`;
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_athlete_month_unique` ON `payments` (`organization_id`,`athlete_id`,`reference_month`) WHERE `status` != 'cancelled';
