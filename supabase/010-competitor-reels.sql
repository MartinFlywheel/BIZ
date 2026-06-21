-- =====================================================
-- Fix: code uses competitor_reels, not competitor_posts
-- Create the correct table if it doesn't exist
-- =====================================================

CREATE TABLE IF NOT EXISTS competitor_reels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id UUID REFERENCES competitors(id) NOT NULL,
  ig_media_id TEXT NOT NULL,
  video_url TEXT,
  thumbnail_url TEXT,
  caption TEXT,
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  saves INTEGER DEFAULT 0,
  published_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(competitor_id, ig_media_id)
);

CREATE INDEX IF NOT EXISTS idx_competitor_reels_competitor ON competitor_reels(competitor_id);

ALTER TABLE competitor_reels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agency_full_access" ON competitor_reels
  FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'agency'));
