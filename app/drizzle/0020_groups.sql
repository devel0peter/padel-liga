CREATE TABLE `group_pairs` (
	`group_id` integer NOT NULL,
	`pair_id` integer NOT NULL,
	`seed` integer NOT NULL,
	PRIMARY KEY(`group_id`, `pair_id`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pair_id`) REFERENCES `pairs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `group_pairs_pair_idx` ON `group_pairs` (`pair_id`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`phase` integer NOT NULL,
	`number` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`published_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_season_phase_number_idx` ON `groups` (`season_id`,`phase`,`number`);--> statement-breakpoint
CREATE TABLE `matches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`pair_a` integer NOT NULL,
	`pair_b` integer NOT NULL,
	`week` integer NOT NULL,
	`deadline` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pair_a`) REFERENCES `pairs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pair_b`) REFERENCES `pairs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matches_group_pairs_idx` ON `matches` (`group_id`,`pair_a`,`pair_b`);--> statement-breakpoint
CREATE INDEX `matches_group_idx` ON `matches` (`group_id`);--> statement-breakpoint
CREATE INDEX `matches_pair_a_idx` ON `matches` (`pair_a`);--> statement-breakpoint
CREATE INDEX `matches_pair_b_idx` ON `matches` (`pair_b`);