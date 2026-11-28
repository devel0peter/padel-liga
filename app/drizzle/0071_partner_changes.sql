CREATE TABLE `partner_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`league_id` integer NOT NULL,
	`season_id` integer NOT NULL,
	`pair_id` integer NOT NULL,
	`started_by` text NOT NULL,
	`leaving_id` text NOT NULL,
	`partner_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`starts_phase` integer,
	`new_pair_id` integer,
	`answered_at` integer,
	`ended_by` text,
	`decided_by` text,
	`decided_at` integer,
	`reason` text,
	`ended_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pair_id`) REFERENCES `pairs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`started_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`leaving_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`partner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`new_pair_id`) REFERENCES `pairs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`ended_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `partner_changes_live_pair_idx` ON `partner_changes` (`pair_id`) WHERE "partner_changes"."status" in ('open', 'accepted', 'final');--> statement-breakpoint
CREATE UNIQUE INDEX `partner_changes_final_partner_idx` ON `partner_changes` (`league_id`,`partner_id`) WHERE "partner_changes"."status" in ('accepted', 'final');--> statement-breakpoint
CREATE INDEX `partner_changes_season_idx` ON `partner_changes` (`season_id`,`status`);--> statement-breakpoint
CREATE INDEX `partner_changes_partner_idx` ON `partner_changes` (`partner_id`);--> statement-breakpoint
ALTER TABLE `match_absences` ADD `partner_change_id` integer REFERENCES partner_changes(id) ON UPDATE no action ON DELETE set null;