CREATE TABLE `match_decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` integer NOT NULL,
	`kind` text NOT NULL,
	`user_id` text,
	`outcome` text NOT NULL,
	`reason` text,
	`at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `match_decisions_match_idx` ON `match_decisions` (`match_id`,`id`);--> statement-breakpoint
ALTER TABLE `match_events` ADD `score` text;--> statement-breakpoint
ALTER TABLE `match_events` ADD `note` text;--> statement-breakpoint
ALTER TABLE `matches` ADD `outcome` text;