-- Queue of "forgot password" requests submitted from the login page,
-- surfaced to admins in Settings for manual reset (no email service wired up yet).

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pwreset_email ON password_reset_requests(email);
