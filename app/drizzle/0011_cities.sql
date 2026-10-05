CREATE TABLE `cities` (
	`slug` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`listed` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
-- Győr was the only city in code (app/lib/cities.ts) until 2026-10-05.
INSERT INTO `cities` (`slug`, `name`, `listed`) VALUES ('gyor', 'Győr', 1);
