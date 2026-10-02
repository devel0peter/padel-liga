CREATE TABLE `broadcasts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`audience` text NOT NULL,
	`recipients` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`broadcast_id` integer,
	`to_email` text NOT NULL,
	`subject` text NOT NULL,
	`html` text,
	`text` text,
	`headers` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`provider_id` text,
	`claimed_at` integer,
	`sent_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`broadcast_id`) REFERENCES `broadcasts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `email_messages_status_idx` ON `email_messages` (`status`,`id`);--> statement-breakpoint
CREATE INDEX `email_messages_sent_at_idx` ON `email_messages` (`sent_at`);--> statement-breakpoint
CREATE INDEX `email_messages_to_idx` ON `email_messages` (`to_email`);--> statement-breakpoint
CREATE TABLE `email_suppressions` (
	`email` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
