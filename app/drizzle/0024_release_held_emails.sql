-- #112: no email waits for an Admin any more. What is still held when this
-- ships goes out with the next cron run, within the daily limit, except mail
-- to an address that unsubscribed, bounced or complained meanwhile: that is
-- deleted, as if it had never been queued (like "Küldés" did, #88). Data only.
DELETE FROM `email_messages`
WHERE `status` = 'held' AND lower(`to_email`) IN (SELECT `email` FROM `email_suppressions`);
--> statement-breakpoint
UPDATE `email_messages` SET `status` = 'pending', `claimed_at` = NULL WHERE `status` = 'held';
