-- Hook (manual — Instagram's API can't tell you what line the creator
-- used to open the piece) and retention/story fields, so the CRM can show
-- them when a content piece is clicked, and so the stories poller has
-- somewhere to write to.
ALTER TABLE content_pieces ADD COLUMN IF NOT EXISTS hook TEXT;
ALTER TABLE content_pieces ADD COLUMN IF NOT EXISTS avg_watch_time_seconds NUMERIC;
ALTER TABLE content_pieces ADD COLUMN IF NOT EXISTS total_interactions INTEGER DEFAULT 0;
ALTER TABLE content_pieces ADD COLUMN IF NOT EXISTS story_expires_at TIMESTAMPTZ;
