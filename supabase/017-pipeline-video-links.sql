-- Track the raw footage link and the edited video link separately from the
-- existing "reference" link (the inspiration/reference reel), so each stage
-- of a piece's production has its own traceable URL instead of everything
-- overwriting the same field.
ALTER TABLE content_pipeline ADD COLUMN IF NOT EXISTS raw_video_url TEXT;
ALTER TABLE content_pipeline ADD COLUMN IF NOT EXISTS edited_video_url TEXT;
