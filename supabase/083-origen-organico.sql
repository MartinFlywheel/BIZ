-- =====================================================
-- 083 — "DM directo / orgánico" como origen del lead
-- =====================================================
--
-- EL PROBLEMA
-- La mayoría de las agendas "Sin origen" del panel "Lo que recibe marketing"
-- son de leads creados a mano con el CTA en blanco (15 de 18 en Mane en los
-- últimos 30 días). Casi siempre es gente que escribió por DM sin pasar por un
-- keyword de ManyChat, pero el panel no lo distinguía de lo que de verdad no
-- se sabe.
--
-- QUÉ SE DECIDIÓ
-- El formulario de Nuevo Lead ahora obliga a elegir una pieza de contenido o
-- "DM directo / orgánico" (src/lib/origen-organico.ts). Lo segundo se guarda
-- como leads.first_touch_type = 'organico', sin content_id. Esta migración
-- enseña a origen_del_lead (de la 082) a traducirlo a 'Orgánico' para
-- agenda_records.de_donde_vino. Los triggers de la 082 ya llaman a esta
-- función, así que marcar un lead como orgánico completa sus agendas vacías.
--
-- Se descartó crear una pieza de contenido falsa llamada "Orgánico": se
-- colaría en las métricas de contenido como si fuera un reel más.
--
-- No se marcan como orgánicos los leads antiguos sin origen: no se sabe si
-- lo fueron. Se pueden marcar uno por uno desde la ficha del lead.
--
-- Idempotente: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION origen_del_lead(p_lead_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT cp.keyword_trigger FROM content_pieces cp WHERE cp.id = l.content_id),
    (SELECT cp.keyword_trigger FROM content_pieces cp WHERE cp.id = l.first_touch_content_id),
    CASE WHEN l.first_touch_type = 'organico' THEN 'Orgánico' END,
    nullif(substring(l.first_touch_type FROM '^manychat:(.+)$'), '')
  )
  FROM leads l
  WHERE l.id = p_lead_id
$$;

GRANT EXECUTE ON FUNCTION origen_del_lead(uuid) TO authenticated;
