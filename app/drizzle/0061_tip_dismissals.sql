CREATE TABLE `tip_dismissals` (
	`user_id` text NOT NULL,
	`tip` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`dismissed_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `tip`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
