CREATE TABLE `landing_views` (
	`day` text NOT NULL,
	`ref` text DEFAULT '' NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `ref`)
);
