ALTER TABLE `season_entries` ADD `opt_out_phase` integer;--> statement-breakpoint
ALTER TABLE `season_entries` ADD `opted_out_by` text REFERENCES users(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `season_entries` ADD `opted_out_at` integer;