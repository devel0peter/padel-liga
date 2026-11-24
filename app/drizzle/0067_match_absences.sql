CREATE TABLE `match_absences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` integer NOT NULL,
	`pair_id` integer NOT NULL,
	`absent_id` text NOT NULL,
	`marked_by` text,
	`marked_at` integer NOT NULL,
	`after_match` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pair_id`) REFERENCES `pairs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`absent_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`marked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_absences_player_idx` ON `match_absences` (`match_id`,`absent_id`);--> statement-breakpoint
-- The named substitutes approved under D109 become marks (#400, D175): the
-- absent player didn't play; whoever stood in is no longer rated.
INSERT INTO `match_absences` (`match_id`, `pair_id`, `absent_id`, `marked_by`, `marked_at`, `after_match`)
SELECT `match_id`, `pair_id`, `absent_id`, `requested_by`, `requested_at`, 0 FROM `match_substitutes` WHERE `status` = 'approved';
