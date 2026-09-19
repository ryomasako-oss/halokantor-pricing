-- WhatsApp number per user, for approval-workflow notifications
-- (submit -> notify managers, decide -> notify the submitting rep).

ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT '';
