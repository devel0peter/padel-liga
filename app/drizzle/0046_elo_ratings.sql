CREATE TABLE `elo_changes` (
	`match_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`rating_before` real NOT NULL,
	`rating_after` real NOT NULL,
	`delta` real NOT NULL,
	`k` real NOT NULL,
	`at` integer NOT NULL,
	PRIMARY KEY(`match_id`, `user_id`),
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `elo_changes_user_idx` ON `elo_changes` (`user_id`,`at`);--> statement-breakpoint
ALTER TABLE `users` ADD `elo` real;