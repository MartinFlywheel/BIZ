-- Drive-style nested folders for organizing sales calls, rooted at two fixed
-- virtual buckets ("Llamadas Cerradas" / "Llamadas No Cerradas") that are not
-- rows here — every folder belongs to one bucket, inherited by its children.
CREATE TABLE call_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES call_folders(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL CHECK (bucket IN ('cerrada', 'no_cerrada')),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX call_folders_client_id_idx ON call_folders(client_id);
CREATE INDEX call_folders_parent_id_idx ON call_folders(parent_id);

-- Which bucket a call is filed under (deal closed vs not) and, optionally,
-- which folder within that bucket. NULL folder_id = directly in the bucket
-- root. Existing calls default to 'no_cerrada' since deal-closed wasn't
-- tracked before this — reclassify them from the UI as needed.
ALTER TABLE sales_calls ADD COLUMN IF NOT EXISTS bucket TEXT CHECK (bucket IN ('cerrada', 'no_cerrada'));
ALTER TABLE sales_calls ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES call_folders(id) ON DELETE SET NULL;

UPDATE sales_calls SET bucket = 'no_cerrada' WHERE bucket IS NULL;

-- RLS — mirrors sales_calls: agency full access, clients read-only their own.
ALTER TABLE call_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agency_full_access" ON call_folders FOR ALL USING (get_user_type() = 'agency');
CREATE POLICY "client_own_data" ON call_folders FOR SELECT USING (
  get_user_type() = 'client' AND client_id = get_user_client_id()
);
