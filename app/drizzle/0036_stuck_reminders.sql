CREATE TABLE `stuck_reminders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`situation` text NOT NULL,
	`league_id` integer NOT NULL,
	`season_id` integer,
	`recipients` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stuck_reminders_key_unique` ON `stuck_reminders` (`key`);--> statement-breakpoint
CREATE INDEX `stuck_reminders_league_idx` ON `stuck_reminders` (`league_id`,`situation`);--> statement-breakpoint
ALTER TABLE `leagues` ADD `reminders_on_at` integer;