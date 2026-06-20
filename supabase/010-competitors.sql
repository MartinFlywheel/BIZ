-- =====================================================
-- COMPETITORS MODULE
-- Track competitor accounts and their content per client.
-- Reels table is designed to be fed by external scrapers
-- (n8n + Apify) via POST /api/webhooks/competitor-sync
-- =====================================================

CREATE TABLE competitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) NOT NULL,
  name TEXT NOT NULL,
  ig_handle TEXT,
  ig_profile_url TEXT,
  ig_account_id TEXT,
  followers INTEGER,
  analisis_estrategico TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_competitors_client ON competitors(client_id);

CREATE TABLE competitor_reels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id UUID REFERENCES competitors(id) NOT NULL,
  ig_media_id TEXT,
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

CREATE INDEX idx_competitor_reels_competitor ON competitor_reels(competitor_id);
CREATE INDEX idx_competitor_reels_published ON competitor_reels(published_at DESC);

-- RLS
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_reels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agency_full_access" ON competitors
  FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'agency'));

CREATE POLICY "agency_full_access" ON competitor_reels
  FOR ALL USING (EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid() AND u.user_type = 'agency'
  ));
