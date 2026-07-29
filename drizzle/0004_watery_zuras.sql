ALTER TABLE `athlete_billing` ADD `provider_customer_id` text;--> statement-breakpoint
ALTER TABLE `athletes` ADD `guardian_document` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `external_provider` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `external_payment_id` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `invoice_url` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `bank_slip_url` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `external_status` text;