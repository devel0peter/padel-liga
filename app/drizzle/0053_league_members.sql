CREATE TABLE `league_members` (
	`league_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`joined_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`league_id`, `user_id`),
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `league_members_user_idx` ON `league_members` (`user_id`);
--> statement-breakpoint
-- Backfill (D128, #331): today's players stay their leagues' players. D93
-- read the interest list: a registered account (first-login page done, not
-- deleted) belonged to the leagues of its signups' cities (either address,
-- withdrawn signups too), and without a signup to every league. Without a
-- signup it now joins only the leagues of Győr (city `gyor`), so no player
-- lands in another city's league. users.email is lowercase.
INSERT OR IGNORE INTO `league_members` (`league_id`, `user_id`, `source`, `joined_at`)
SELECT l.`id`, u.`id`, 'carried', u.`consent_at`
FROM `users` u JOIN `leagues` l
WHERE u.`consent_at` IS NOT NULL AND u.`deleted_at` IS NULL AND (
  EXISTS (SELECT 1 FROM `interest_signups` s WHERE s.`city` = l.`city`
    AND (lower(s.`email1`) = u.`email` OR lower(s.`email2`) = u.`email`))
  OR (l.`city` = 'gyor' AND NOT EXISTS (SELECT 1 FROM `interest_signups` s
    WHERE lower(s.`email1`) = u.`email` OR lower(s.`email2`) = u.`email`))
);
--> statement-breakpoint
-- The players of a pair with an entry in one of the league's seasons, then
-- of any pair of the league (they count anyway; the row keeps them a member
-- if the pair goes with a deleted account).
INSERT OR IGNORE INTO `league_members` (`league_id`, `user_id`, `source`, `joined_at`)
SELECT p.`league_id`, u.`id`, 'entry', min(e.`created_at`)
FROM `season_entries` e JOIN `pairs` p ON p.`id` = e.`pair_id`
JOIN `users` u ON u.`id` IN (p.`player_a`, p.`player_b`) AND u.`deleted_at` IS NULL
GROUP BY p.`league_id`, u.`id`;
--> statement-breakpoint
INSERT OR IGNORE INTO `league_members` (`league_id`, `user_id`, `source`, `joined_at`)
SELECT p.`league_id`, u.`id`, 'pair', min(p.`created_at`)
FROM `pairs` p JOIN `users` u ON u.`id` IN (p.`player_a`, p.`player_b`) AND u.`deleted_at` IS NULL
GROUP BY p.`league_id`, u.`id`;
--> statement-breakpoint
-- "Párt keresek" is off by default from now on (#333). Whoever is on today
-- only by the old default (D59: a solo signup in the league's city, not
-- withdrawn, still waiting for a partner or paired with a solo whose person
-- registered) keeps it on: the default becomes a stored row, dated from the
-- signup, as Párkeresők ordered them. Stored choices are kept as they are.
INSERT OR IGNORE INTO `partner_searches` (`league_id`, `user_id`, `seeking`, `updated_at`)
SELECT l.`id`, u.`id`, 1, min(s.`created_at`)
FROM `leagues` l JOIN `interest_signups` s ON s.`city` = l.`city`
JOIN `users` u ON u.`email` = lower(s.`email1`)
WHERE u.`consent_at` IS NOT NULL AND u.`deleted_at` IS NULL
  AND s.`mode` = 'solo' AND s.`status` <> 'withdrawn'
  AND (s.`paired_with` IS NULL
    OR NOT EXISTS (SELECT 1 FROM `interest_signups` o WHERE o.`id` = s.`paired_with`)
    OR EXISTS (SELECT 1 FROM `interest_signups` o JOIN `users` ou ON ou.`email` = lower(o.`email1`)
      WHERE o.`id` = s.`paired_with` AND ou.`consent_at` IS NOT NULL))
GROUP BY l.`id`, u.`id`;
--> statement-breakpoint
-- Párkeresők listed every registered player with "Párt keresek" on, in any
-- league, whatever D93 said: whoever is on in a league (by their own switch
-- or the default just stored) stays its player, so nobody drops off it.
INSERT OR IGNORE INTO `league_members` (`league_id`, `user_id`, `source`, `joined_at`)
SELECT ps.`league_id`, u.`id`, 'carried', ps.`updated_at`
FROM `partner_searches` ps JOIN `users` u ON u.`id` = ps.`user_id`
WHERE ps.`seeking` = 1 AND u.`consent_at` IS NOT NULL AND u.`deleted_at` IS NULL;