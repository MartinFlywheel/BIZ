-- =====================================================
-- COMPETITOR TRACKING — scraped via Apify + n8n
-- =====================================================

CREATE TABLE competitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) NOT NULL,
  ig_handle TEXT NOT NULL,
  ig_profile_url TEXT,
  name TEXT,
  followers INTEGER DEFAULT 0,
  bio TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE competitor_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id UUID REFERENCES competitors(id) NOT NULL,
  ig_media_id TEXT,
  media_type TEXT,
  caption TEXT,
  permalink TEXT,
  thumbnail_url TEXT,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  views INTEGER DEFAULT 0,
  engagement_rate DECIMAL(5,2) DEFAULT 0,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(competitor_id, ig_media_id)
);

CREATE INDEX idx_competitors_client ON competitors(client_id);
CREATE INDEX idx_competitor_posts_competitor ON competitor_posts(competitor_id);

ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agency_full_access" ON competitors
  FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'agency'));
CREATE POLICY "agency_full_access" ON competitor_posts
  FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'agency'));
