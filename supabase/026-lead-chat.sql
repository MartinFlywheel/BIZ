-- Turns incoming_messages into a real two-way thread per lead, backing the
-- new /clients/[id]/chat/[leadId] page. Until now the webhook only ever
-- wrote inbound (lead-sent) rows and explicitly skipped Meta's "echo"
-- events (messages the page itself sent, e.g. ManyChat's bot replies) —
-- direction/sent_by let both directions live in the same ordered thread.
ALTER TABLE incoming_messages ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound'));
ALTER TABLE incoming_messages ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE incoming_messages ADD COLUMN IF NOT EXISTS sent_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_incoming_messages_lead_id ON incoming_messages(lead_id);
