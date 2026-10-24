CREATE TABLE `pair_invites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`league_id` integer NOT NULL,
	`inviter_id` text NOT NULL,
	`invitee_email` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`responded_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pair_invites_token_hash_unique` ON `pair_invites` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `pair_invites_pending_idx` ON `pair_invites` (`league_id`,`inviter_id`) WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX `pair_invites_invitee_idx` ON `pair_invites` (`invitee_email`,`status`);--> statement-breakpoint
CREATE INDEX `pair_invites_inviter_idx` ON `pair_invites` (`inviter_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `pairs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`league_id` integer NOT NULL,
	`player_a` text NOT NULL,
	`player_b` text NOT NULL,
	`invite_id` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`dissolved_at` integer,
	`dissolved_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_a`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_b`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invite_id`) REFERENCES `pair_invites`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`dissolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pairs_invite_id_unique` ON `pairs` (`invite_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pairs_active_a_idx` ON `pairs` (`league_id`,`player_a`) WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `pairs_active_b_idx` ON `pairs` (`league_id`,`player_b`) WHERE status = 'active';