CREATE TABLE `job_runs` (
	`key` text PRIMARY KEY NOT NULL,
	`done_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `notifications` ADD `push_due_at` integer;--> statement-breakpoint
CREATE INDEX `notifications_push_due_idx` ON `notifications` (`push_due_at`);