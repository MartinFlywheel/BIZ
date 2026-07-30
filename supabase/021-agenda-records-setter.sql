-- Who booked the appointment (distinct from "closer", who ran the call) —
-- needed now that a client can have multiple setters, so payouts can be
-- attributed to the right person per lead.
ALTER TABLE agenda_records ADD COLUMN IF NOT EXISTS setter TEXT;
