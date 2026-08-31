-- Links a client to their Meta Ads account (act_XXXXXXXXXXXX), the same way
-- ig_account_id links them to their Instagram account. Powers /clients/[id]/ads.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS ad_account_id TEXT;
