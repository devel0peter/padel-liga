CREATE TABLE `match_substitutes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` integer NOT NULL,
	`pair_id` integer NOT NULL,
	`absent_id` text NOT NULL,
	`substitute_id` text NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`requested_by` text,
	`requested_at` integer NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`reason` text,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pair_id`) REFERENCES `pairs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`absent_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`substitute_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_substitutes_live_idx` ON `match_substitutes` (`match_id`,`absent_id`) WHERE "match_substitutes"."status" in ('requested', 'approved');--> statement-breakpoint
CREATE INDEX `match_substitutes_match_idx` ON `match_substitutes` (`match_id`);--> statement-breakpoint
CREATE INDEX `match_substitutes_status_idx` ON `match_substitutes` (`status`);