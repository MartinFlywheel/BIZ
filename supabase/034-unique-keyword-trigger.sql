-- keyword_trigger is how every ManyChat webhook call resolves which client
-- a lead belongs to (ilike match, no client scoping — it can't be scoped,
-- the URL only carries the piece code). With no uniqueness constraint,
-- two clients picking the same code (very plausible: the app suggests the
-- same example convention — C_21_04, R_19_04, H_13_07 — to everyone)
-- silently misattributes leads/interactions to the wrong client, with no
-- error anywhere. This makes that impossible at the database level.

-- Run this FIRST. If it returns any rows, resolve those duplicates
-- (rename one of the colliding keyword_triggers) before running the
-- CREATE UNIQUE INDEX below — it will fail otherwise.
--
-- SELECT lower(keyword_trigger) AS trigger, array_agg(id) AS piece_ids, array_agg(client_id) AS client_ids
-- FROM content_pieces
-- WHERE keyword_trigger IS NOT NULL AND keyword_trigger <> ''
-- GROUP BY lower(keyword_trigger)
-- HAVING count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_pieces_keyword_trigger_unique
  ON content_pieces (lower(keyword_trigger))
  WHERE keyword_trigger IS NOT NULL AND keyword_trigger <> '';
