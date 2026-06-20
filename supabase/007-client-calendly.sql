-- Add Calendly fields to clients table
ALTER TABLE clients ADD COLUMN IF NOT EXISTS calendly_token TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS calendly_org_uri TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS calendly_webhook_id TEXT;
