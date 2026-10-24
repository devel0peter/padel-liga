-- #88 (D24): mail queued but not sent yet, other than login codes and signup
-- confirmations, waits for an Admin on /admin/outbox. Data only, no schema
-- change: "held" is a new value of email_messages.status.
UPDATE `email_messages` SET `status` = 'held', `claimed_at` = NULL
WHERE `status` IN ('pending', 'sending') AND `kind` NOT IN ('login_code', 'signup_confirmation');
