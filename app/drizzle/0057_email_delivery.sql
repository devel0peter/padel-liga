ALTER TABLE `email_messages` ADD `delivery` text;--> statement-breakpoint
ALTER TABLE `email_messages` ADD `delivery_at` integer;--> statement-breakpoint
CREATE INDEX `email_messages_provider_idx` ON `email_messages` (`provider_id`);