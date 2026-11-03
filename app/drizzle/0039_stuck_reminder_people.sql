CREATE TABLE `stuck_reminder_people` (
	`season_id` integer NOT NULL,
	`email` text NOT NULL,
	`situation` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`season_id`, `email`),
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade
);
