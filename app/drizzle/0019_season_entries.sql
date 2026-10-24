CREATE TABLE `season_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`pair_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`note` text,
	`decided_by` text,
	`decided_at` integer,
	`joins_phase` integer,
	`updated_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pair_id`) REFERENCES `pairs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `season_entries_season_pair_idx` ON `season_entries` (`season_id`,`pair_id`);--> statement-breakpoint
CREATE INDEX `season_entries_pair_idx` ON `season_entries` (`pair_id`);