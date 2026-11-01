ALTER TABLE `users` ADD `last_login_at` integer;
--> statement-breakpoint
-- Best guess for existing accounts: their newest session still stored (a
-- logout deletes it, so some stay null until they log in again).
UPDATE `users` SET `last_login_at` = (SELECT max(`created_at`) FROM `sessions` WHERE `sessions`.`user_id` = `users`.`id`);
