CREATE TABLE `interest_signups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mode` text NOT NULL,
	`name1` text NOT NULL,
	`email1` text NOT NULL,
	`name2` text,
	`email2` text,
	`level` text NOT NULL,
	`note` text,
	`consent_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
