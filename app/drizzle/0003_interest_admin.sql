ALTER TABLE `interest_signups` ADD `status` text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE `interest_signups` ADD `admin_note` text;--> statement-breakpoint
ALTER TABLE `interest_signups` ADD `updated_at` integer;