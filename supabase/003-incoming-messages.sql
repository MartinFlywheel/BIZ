-- =====================================================
-- INCOMING MESSAGES — Clean inbox from Instagram DMs
-- Feeds from webhook_logs (processed in real-time or batch)
-- User promotes relevant messages → interactions table
-- =====================================================

CREATE TABLE incoming_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_ig_id TEXT NOT NULL,
  sender_ig_username TEXT,
  recipient_ig_id TEXT,
  message_text TEXT,
  message_mid TEXT UNIQUE,              -- Meta message ID, prevents duplicates
  media_url TEXT,                        -- If message contains media
  message_type TEXT CHECK (message_type IN ('text', 'media', 'story_reply', 'reaction', 'other')) DEFAULT 'text',
  status TEXT CHECK (status IN ('unread', 'read', 'promoted', 'archived')) DEFAULT 'unread',
  client_id UUID REFERENCES clients(id), -- Matched client (by recipient IG account)
  webhook_log_id UUID,                   -- Traceability back to raw log
  promoted_to_interaction_id UUID REFERENCES interactions(id),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_incoming_messages_status ON incoming_messages(status);
CREATE INDEX idx_incoming_messages_sender ON incoming_messages(sender_ig_id);
CREATE INDEX idx_incoming_messages_client ON incoming_messages(client_id);
CREATE INDEX idx_incoming_messages_mid ON incoming_messages(message_mid);

-- RLS
ALTER TABLE incoming_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agency_full_access" ON incoming_messages
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND user_type = 'agency')
  );
