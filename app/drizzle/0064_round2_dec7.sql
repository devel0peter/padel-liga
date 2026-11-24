-- #393 (D172): no holiday break in Győr's first season. Round 2 starts on
-- Mon 7 Dec 2026, right after round 1 (extended to 6 Dec), and runs 4 weeks
-- through the holidays to Sun 3 Jan 2027 23:59; rounds 3 and 4 follow with
-- no break: 4–24 Jan and 25 Jan – 14 Feb. Data only.
--
-- Touches rounds 2–4 of a season only while all four of its rounds still
-- hold the old dates (1: 9 Nov – 6 Dec, 2: 4–24 Jan, 3: 25 Jan – 14 Feb,
-- 4: 15 Feb – 7 Mar) and none of its rounds 2–4 has published groups (so no
-- match carries one of their deadlines yet). Anywhere else, and on a second
-- run, it changes nothing. Round 1, the groups, matches, results and
-- deadlines are never touched.
--
-- Unix seconds, Budapest (UTC+1 all winter): a round starts Monday 00:00 and
-- ends Sunday 23:59. The season is picked by its subquery before any row
-- changes, so the three rows move together.
UPDATE `season_phases`
SET
  `starts_at` = CASE `number` WHEN 2 THEN 1796598000 WHEN 3 THEN 1799017200 WHEN 4 THEN 1800831600 END,
  `deadline` = CASE `number` WHEN 2 THEN 1799017140 WHEN 3 THEN 1800831540 WHEN 4 THEN 1802645940 END
WHERE `number` IN (2, 3, 4)
  AND `season_id` IN (
    SELECT p1.`season_id`
    FROM `season_phases` p1
    JOIN `season_phases` p2 ON p2.`season_id` = p1.`season_id` AND p2.`number` = 2
    JOIN `season_phases` p3 ON p3.`season_id` = p1.`season_id` AND p3.`number` = 3
    JOIN `season_phases` p4 ON p4.`season_id` = p1.`season_id` AND p4.`number` = 4
    WHERE p1.`number` = 1
      AND p1.`starts_at` = 1794178800 AND p1.`deadline` = 1796597940
      AND p2.`starts_at` = 1799017200 AND p2.`deadline` = 1800831540
      AND p3.`starts_at` = 1800831600 AND p3.`deadline` = 1802645940
      AND p4.`starts_at` = 1802646000 AND p4.`deadline` = 1804460340
      AND NOT EXISTS (
        SELECT 1 FROM `groups` g
        WHERE g.`season_id` = p1.`season_id` AND g.`phase` IN (2, 3, 4) AND g.`published_at` IS NOT NULL
      )
  );
