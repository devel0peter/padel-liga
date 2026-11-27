ALTER TABLE `users` ADD `surname` text;--> statement-breakpoint
ALTER TABLE `users` ADD `first_name` text;--> statement-breakpoint
-- #419, D182: fill both from the full name, nothing smarter. The text before
-- the first space is the surname, the rest the first name; a one-word name
-- is only a surname. Peter checks the result by hand (western-order names).
-- An empty name stays empty, and an anonymized account ("Törölt játékos")
-- keeps no name parts.
UPDATE `users` SET
  `surname` = CASE WHEN instr(trim(`name`), ' ') > 0 THEN substr(trim(`name`), 1, instr(trim(`name`), ' ') - 1) ELSE nullif(trim(`name`), '') END,
  `first_name` = CASE WHEN instr(trim(`name`), ' ') > 0 THEN trim(substr(trim(`name`), instr(trim(`name`), ' ') + 1)) ELSE NULL END
WHERE `deleted_at` IS NULL;
