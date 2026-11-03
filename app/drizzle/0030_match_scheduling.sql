CREATE TABLE `match_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` integer NOT NULL,
	`pair_id` integer NOT NULL,
	`user_id` text,
	`kind` text NOT NULL,
	`slots` text,
	`slot` integer,
	`club_id` integer,
	`at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pair_id`) REFERENCES `pairs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `match_events_match_idx` ON `match_events` (`match_id`,`id`);--> statement-breakpoint
ALTER TABLE `matches` ADD `scheduled_at` integer;--> statement-breakpoint
ALTER TABLE `matches` ADD `club_id` integer REFERENCES clubs(id);--> statement-breakpoint
ALTER TABLE `matches` ADD `revision` integer DEFAULT 0 NOT NULL;