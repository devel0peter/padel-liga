CREATE TABLE `season_phases` (
	`season_id` integer NOT NULL,
	`number` integer NOT NULL,
	`starts_at` integer NOT NULL,
	`deadline` integer NOT NULL,
	PRIMARY KEY(`season_id`, `number`),
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `seasons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`league_id` integer NOT NULL,
	`name` text NOT NULL,
	`registration_opens_at` integer NOT NULL,
	`registration_closes_at` integer NOT NULL,
	`first_phase_start` text NOT NULL,
	`breaks` text DEFAULT '[]' NOT NULL,
	`updated_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `seasons_league_idx` ON `seasons` (`league_id`);