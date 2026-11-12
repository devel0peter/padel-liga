DROP INDEX `email_messages_open_token_idx`;--> statement-breakpoint
ALTER TABLE `email_messages` DROP COLUMN `open_token`;--> statement-breakpoint
ALTER TABLE `email_messages` DROP COLUMN `opened_at`;--> statement-breakpoint
ALTER TABLE `email_messages` DROP COLUMN `open_count`;