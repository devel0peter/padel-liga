CREATE TABLE `strikes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`pair_id` integer,
	`match_id` integer,
	`source` text NOT NULL,
	`at` integer NOT NULL,
	`cancelled_at` integer,
	`cancelled_by` text,
	`cancel_reason` text,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pair_id`) REFERENCES `pairs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cancelled_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `strikes_season_user_idx` ON `strikes` (`season_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `strikes_match_user_source_idx` ON `strikes` (`match_id`,`user_id`,`source`);