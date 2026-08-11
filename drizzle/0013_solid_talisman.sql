CREATE TABLE `notification_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`notification_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`origin` text NOT NULL,
	`lock_token` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`provider_message_id` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`notification_id`) REFERENCES `notification_outbox`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_attempts_lock_token_unique` ON `notification_attempts` (`lock_token`);--> statement-breakpoint
CREATE INDEX `notification_attempts_notification_idx` ON `notification_attempts` (`notification_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `notification_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`athlete_id` text NOT NULL,
	`payment_id` text,
	`team_id` text,
	`legacy_notification_id` text,
	`original_notification_id` text,
	`event_type` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`phone` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`next_attempt_at` integer,
	`locked_at` integer,
	`locked_until` integer,
	`lock_token` text,
	`last_error` text,
	`sent_at` integer,
	`provider_message_id` text,
	`last_attempt_origin` text,
	`manual_resend_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`athlete_id`) REFERENCES `athletes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_outbox_idempotency_unique` ON `notification_outbox` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `notification_outbox_eligible_idx` ON `notification_outbox` (`organization_id`,`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `notification_outbox_original_idx` ON `notification_outbox` (`original_notification_id`);
--> statement-breakpoint
INSERT INTO `notification_outbox` (
	`id`, `organization_id`, `athlete_id`, `payment_id`,
	`legacy_notification_id`, `event_type`, `idempotency_key`,
	`phone`, `message`, `status`, `attempt_count`, `max_attempts`,
	`last_error`, `sent_at`, `last_attempt_origin`, `created_at`, `updated_at`
)
SELECT
	'legacy:' || `id`, `organization_id`, `athlete_id`, `payment_id`,
	`id`, `type`, 'billing:' || `payment_id` || ':' || `type`,
	`phone`, `message`, `status`,
	CASE WHEN `status` = 'failed' THEN 3 ELSE 1 END,
	3, `error`, `sent_at`, 'automatic', `created_at`, `updated_at`
FROM `billing_notifications`
WHERE 1
ON CONFLICT(`idempotency_key`) DO NOTHING;
