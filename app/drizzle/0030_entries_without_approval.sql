-- #153 (D60): a season entry counts at once, no organizer approval. An entry
-- still pending when this ships is entered now, with its joining phase worked
-- out as if approved at this moment (joinsPhase in season-entries.ts): the
-- first phase that hasn't started, skipping phase 1 once the season has
-- published groups; none left: the next season (null). No email or notice
-- goes out. Approved, rejected and withdrawn entries don't change. Data only.
UPDATE `season_entries`
SET `status` = 'approved',
  `joins_phase` = (
    SELECT min(sp.`number`) FROM `season_phases` sp
    WHERE sp.`season_id` = `season_entries`.`season_id`
      AND sp.`starts_at` > unixepoch()
      AND NOT (sp.`number` = 1 AND EXISTS (
        SELECT 1 FROM `groups` g WHERE g.`season_id` = `season_entries`.`season_id` AND g.`published_at` IS NOT NULL
      ))
  ),
  `decided_at` = unixepoch(),
  `updated_at` = unixepoch()
WHERE `status` = 'pending';
