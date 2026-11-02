CREATE TABLE `match_reminders` (
	`match_id` integer NOT NULL,
	`kind` text NOT NULL,
	`slot` integer DEFAULT 0 NOT NULL,
	`sent_at` integer NOT NULL,
	PRIMARY KEY(`match_id`, `kind`, `slot`),
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `match_events` ADD `court` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `digested_at` integer;