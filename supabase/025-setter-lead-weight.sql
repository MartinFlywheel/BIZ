-- Per-setter relative weight for lead_calificado auto-assignment.
-- A plain relative weight, not a percentage that has to sum to 100 —
-- pickBalancedSetter() in src/lib/manychat.ts normalizes by whatever
-- weights the client's active setters currently have, so it stays correct
-- as setters are added/removed. Equal weights (the default) split evenly.
ALTER TABLE users ADD COLUMN IF NOT EXISTS lead_weight INTEGER NOT NULL DEFAULT 1 CHECK (lead_weight > 0);
