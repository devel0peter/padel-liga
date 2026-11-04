CREATE TABLE `push_stats_daily` (
	`day` text PRIMARY KEY NOT NULL,
	`players` integer NOT NULL,
	`push_users` integer NOT NULL,
	`devices` integer NOT NULL
);
