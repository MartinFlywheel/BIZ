-- The "CTA" column in the CRM Leads table reads leads.content_id, which
-- used to be set only by hand (staff picking a piece from a dropdown) —
-- separate from first_touch_content_id, which the ManyChat webhooks already
-- populate automatically on lead creation. The webhooks now set content_id
-- too going forward; this backfills existing leads the webhook already
-- attributed correctly, without touching any lead a staff member already
-- manually tagged (content_id IS NULL guard).

UPDATE leads
SET content_id = first_touch_content_id
WHERE content_id IS NULL AND first_touch_content_id IS NOT NULL;
