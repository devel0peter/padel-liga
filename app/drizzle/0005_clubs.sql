CREATE TABLE `clubs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`city` text NOT NULL,
	`name` text NOT NULL,
	`admin_note` text,
	`updated_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clubs_slug_unique` ON `clubs` (`slug`);--> statement-breakpoint
ALTER TABLE `interest_signups` ADD `ref` text;--> statement-breakpoint
ALTER TABLE `interest_signups` ADD `home_club` text;