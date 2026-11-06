ALTER TABLE `leagues` ADD `min_entries` integer DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE `seasons` ADD `starts_at_minimum` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `seasons` ADD `start_fixed_at` integer;