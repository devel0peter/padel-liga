-- #398, D177: "Párt keresek" switched on under the new wording (the league's
-- other seekers see the player too) is listed on Párkereső. Every existing
-- row keeps its organizer-only meaning: not listed until switched on again.
ALTER TABLE `partner_searches` ADD `listed` integer DEFAULT false NOT NULL;
