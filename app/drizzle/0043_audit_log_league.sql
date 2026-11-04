ALTER TABLE `audit_log` ADD `league_id` integer REFERENCES leagues(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `audit_log_at_idx` ON `audit_log` (`at`);--> statement-breakpoint
CREATE INDEX `audit_log_league_idx` ON `audit_log` (`league_id`);--> statement-breakpoint
-- Backfill (#226): the league of the rows written before #225, from the
-- shapes they were written in. Only fills the new column; nothing else changes.
-- target "league:<id>" or "league:<slug>" (league.create, reminders, partner search)
UPDATE `audit_log` SET `league_id` = (
  SELECT `id` FROM `leagues` WHERE `audit_log`.`target` IN ('league:' || `leagues`.`id`, 'league:' || `leagues`.`slug`)
) WHERE `league_id` IS NULL AND `target` LIKE 'league:%';--> statement-breakpoint
-- detail "league:<id or slug>[; ...]" (Szervező appointments, pairs)
UPDATE `audit_log` SET `league_id` = (
  SELECT `id` FROM `leagues` WHERE substr(`audit_log`.`detail`, 8, instr(`audit_log`.`detail` || ';', ';') - 8) IN (CAST(`leagues`.`id` AS TEXT), `leagues`.`slug`)
) WHERE `league_id` IS NULL AND `detail` LIKE 'league:%';--> statement-breakpoint
-- detail "invite:<league id>" (a Szervező invite accepted)
UPDATE `audit_log` SET `league_id` = (
  SELECT `id` FROM `leagues` WHERE substr(`audit_log`.`detail`, 8) = CAST(`leagues`.`id` AS TEXT)
) WHERE `league_id` IS NULL AND `detail` LIKE 'invite:%';--> statement-breakpoint
-- target "season:<id>" (seasons, groups)
UPDATE `audit_log` SET `league_id` = (
  SELECT `league_id` FROM `seasons` WHERE `audit_log`.`target` = 'season:' || `seasons`.`id`
) WHERE `league_id` IS NULL AND `target` LIKE 'season:%';--> statement-breakpoint
-- target "season_entry:<id>" (organizer enter and take-out)
UPDATE `audit_log` SET `league_id` = (
  SELECT `s`.`league_id` FROM `season_entries` `e` JOIN `seasons` `s` ON `s`.`id` = `e`.`season_id`
  WHERE `audit_log`.`target` = 'season_entry:' || `e`.`id`
) WHERE `league_id` IS NULL AND `target` LIKE 'season_entry:%';--> statement-breakpoint
-- detail "season:<id> groups:..." (mid-phase withdrawal)
UPDATE `audit_log` SET `league_id` = (
  SELECT `league_id` FROM `seasons` WHERE substr(`audit_log`.`detail`, 8, instr(`audit_log`.`detail` || ' ', ' ') - 8) = CAST(`seasons`.`id` AS TEXT)
) WHERE `league_id` IS NULL AND `detail` LIKE 'season:%';
