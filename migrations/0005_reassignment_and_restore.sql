-- Trial feedback 2026-09-21: quotations must be reassignable to another
-- user when the responsible person is absent (manager-gated), and a
-- restored revision must carry an identifiable name tag. restore_count
-- backs the "restore-<client>-<n>" tag so it counts per-quote.

ALTER TABLE quotes ADD COLUMN assigned_to INTEGER REFERENCES users(id);
ALTER TABLE quotes ADD COLUMN restore_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_quotes_assigned_to ON quotes(assigned_to);
