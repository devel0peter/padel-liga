CREATE TABLE `feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`rating` integer,
	`page` text NOT NULL,
	`device` text NOT NULL,
	`browser` text NOT NULL,
	`app_version` text NOT NULL,
	`user_id` text,
	`created_at` integer NOT NULL,
	`done_at` integer,
	`done_by` text,
	`reopened_at` integer,
	`reopened_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`done_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reopened_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `feedback_created_idx` ON `feedback` (`created_at`);--> statement-breakpoint
CREATE INDEX `feedback_user_idx` ON `feedback` (`user_id`,`created_at`);