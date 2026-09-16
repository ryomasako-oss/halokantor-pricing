-- Optimistic-locking column for concurrent quote edits, plus indexes for
-- query patterns that were previously unindexed (approvals by quote,
-- quotes filtered by owner).

ALTER TABLE quotes ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_appr_quote_decision ON approvals(quote_id, decision);
CREATE INDEX IF NOT EXISTS idx_quotes_created_by ON quotes(created_by);
