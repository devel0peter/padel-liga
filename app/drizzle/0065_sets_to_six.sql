-- #396, D173: a set goes to 6 games from Győr's round 2 on. The format is
-- stored per round; every round gets 6, new ones by the default.
ALTER TABLE `season_phases` ADD `set_games` integer DEFAULT 6 NOT NULL;
--> statement-breakpoint
-- A round 1 whose groups are already out was played with short sets (to 4):
-- it keeps them, so its results stay valid. That is Győr's running round 1.
UPDATE `season_phases` SET `set_games` = 4
WHERE `number` = 1
  AND EXISTS (
    SELECT 1 FROM `groups` g
    WHERE g.`season_id` = `season_phases`.`season_id` AND g.`phase` = 1 AND g.`published_at` IS NOT NULL
  );
