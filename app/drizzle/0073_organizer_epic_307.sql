CREATE TABLE `league_signup_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`league_id` integer NOT NULL,
	`kind` text NOT NULL,
	`joins_phase` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `league_signup_events_league_at_idx` ON `league_signup_events` (`league_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `broadcasts` ADD `league_id` integer REFERENCES leagues(id);--> statement-breakpoint
CREATE INDEX `broadcasts_league_idx` ON `broadcasts` (`league_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `email_messages` ADD `league_id` integer REFERENCES leagues(id);--> statement-breakpoint
CREATE INDEX `email_messages_league_idx` ON `email_messages` (`league_id`,`kind`,`status`);--> statement-breakpoint
ALTER TABLE `league_admins` ADD `privacy_agreement_at` integer;--> statement-breakpoint
ALTER TABLE `leagues` ADD `contact_name` text;--> statement-breakpoint
ALTER TABLE `leagues` ADD `contact_email` text;--> statement-breakpoint
ALTER TABLE `leagues` ADD `contact_phone` text;--> statement-breakpoint
ALTER TABLE `leagues` ADD `local_rules` text;--> statement-breakpoint
ALTER TABLE `leagues` ADD `register_link_shared_at` integer;--> statement-breakpoint
ALTER TABLE `notifications` ADD `league_id` integer REFERENCES leagues(id);--> statement-breakpoint
ALTER TABLE `notifications` ADD `pushed_at` integer;--> statement-breakpoint
CREATE INDEX `notifications_league_kind_idx` ON `notifications` (`user_id`,`league_id`,`kind`,`id`);
--> statement-breakpoint
UPDATE `leagues` SET `contact_name` = 'Péter, Padelpárbaj', `contact_email` = 'hello@padelparbaj.hu' WHERE `slug` = 'gyor' AND `contact_name` IS NULL;
