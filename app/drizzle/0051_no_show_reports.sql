CREATE TABLE `no_show_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` integer NOT NULL,
	`pair_id` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`reported_by` text,
	`reported_at` integer NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`reason` text,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pair_id`) REFERENCES `pairs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reported_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `no_show_reports_open_idx` ON `no_show_reports` (`match_id`) WHERE "no_show_reports"."status" = 'open';--> statement-breakpoint
CREATE INDEX `no_show_reports_match_idx` ON `no_show_reports` (`match_id`);--> statement-breakpoint
CREATE INDEX `no_show_reports_status_idx` ON `no_show_reports` (`status`);