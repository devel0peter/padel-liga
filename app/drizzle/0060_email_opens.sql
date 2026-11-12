ALTER TABLE `email_messages` ADD `open_token` text;--> statement-breakpoint
ALTER TABLE `email_messages` ADD `opened_at` integer;--> statement-breakpoint
ALTER TABLE `email_messages` ADD `open_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `email_messages_open_token_idx` ON `email_messages` (`open_token`);