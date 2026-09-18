-- =====================================================
-- 082 — La agenda hereda el origen de su lead
-- =====================================================
--
-- EL PROBLEMA
-- El panel "Lo que recibe marketing" agrupa las agendas por de_donde_vino (la
-- columna CTA). Ese valor se copia del lead una sola vez: al crear la agenda o
-- al asociarle el lead (codigoDeOrigenDelLead en src/lib/services/origen-lead.ts).
-- Si el lead consigue su origen después (el setter elige el CTA en la ficha,
-- llega la interacción de ManyChat, o la 081 fusionó un duplicado que sí lo
-- tenía), la agenda se queda en "Sin origen" para siempre. Es el caso de
-- karencita.zzz: su lead viene de R_13_09 y su agenda salía sin origen.
--
-- Ojo: esto no resuelve la mayoría de las agendas "Sin origen". Esas son de
-- leads creados a mano sin elegir CTA, y ahí el dato no existe en ninguna
-- parte. Con este trigger, en cuanto alguien le pone el CTA al lead, su agenda
-- lo recibe sola.
--
-- QUÉ SE DECIDIÓ
-- Un trigger en cada lado, con la misma regla que codigoDeOrigenDelLead: la
-- pieza del lead (content_id), la del primer contacto (first_touch_content_id)
-- y, si no hay, el código de "manychat:{código}" en first_touch_type.
--   - agenda_records: al insertar o cambiar lead_id, si de_donde_vino está
--     vacío, se completa desde el lead.
--   - leads: al cambiar su origen, se completan sus agendas con de_donde_vino
--     vacío.
-- Nunca se pisa un de_donde_vino que ya tenga texto: puede venir escrito a
-- mano en la planilla de Agendas.
--
-- Se descartó hacerlo solo en el código: hay al menos cinco vías que cambian
-- el origen de un lead (formularios, webhook de ManyChat, promoteToLead,
-- fusiones SQL) y cualquiera nueva lo volvería a olvidar.
--
-- Idempotente: CREATE OR REPLACE, DROP TRIGGER IF EXISTS, y el relleno solo
-- toca agendas vacías.

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
    nullif(substring(l.first_touch_type FROM '^manychat:(.+)$'), '')
  )
  FROM leads l
  WHERE l.id = p_lead_id
$$;

GRANT EXECUTE ON FUNCTION origen_del_lead(uuid) TO authenticated;

-- Lado agenda: al crearla o asociarle un lead.
CREATE OR REPLACE FUNCTION agenda_origen_desde_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL AND nullif(btrim(NEW.de_donde_vino), '') IS NULL THEN
    NEW.de_donde_vino := coalesce(origen_del_lead(NEW.lead_id), NEW.de_donde_vino);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agenda_origen_desde_lead ON agenda_records;
CREATE TRIGGER trg_agenda_origen_desde_lead
  BEFORE INSERT OR UPDATE OF lead_id, de_donde_vino ON agenda_records
  FOR EACH ROW EXECUTE FUNCTION agenda_origen_desde_lead();

-- Lado lead: cuando consigue (o cambia) su origen.
CREATE OR REPLACE FUNCTION lead_origen_a_agendas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  codigo text;
BEGIN
  codigo := origen_del_lead(NEW.id);
  IF codigo IS NOT NULL THEN
    UPDATE agenda_records
    SET de_donde_vino = codigo, updated_at = now()
    WHERE lead_id = NEW.id
      AND nullif(btrim(de_donde_vino), '') IS NULL;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_origen_a_agendas ON leads;
CREATE TRIGGER trg_lead_origen_a_agendas
  AFTER UPDATE OF content_id, first_touch_content_id, first_touch_type ON leads
  FOR EACH ROW
  WHEN (
    NEW.content_id IS DISTINCT FROM OLD.content_id
    OR NEW.first_touch_content_id IS DISTINCT FROM OLD.first_touch_content_id
    OR NEW.first_touch_type IS DISTINCT FROM OLD.first_touch_type
  )
  EXECUTE FUNCTION lead_origen_a_agendas();

-- Relleno de lo que ya quedó vacío.
UPDATE agenda_records a
SET de_donde_vino = origen_del_lead(a.lead_id), updated_at = now()
WHERE a.lead_id IS NOT NULL
  AND nullif(btrim(a.de_donde_vino), '') IS NULL
  AND origen_del_lead(a.lead_id) IS NOT NULL;

-- Verificación: agendas con lead que siguen sin origen aunque su lead lo
-- tiene. Debe devolver 0.
SELECT count(*) AS pendientes
FROM agenda_records a
WHERE a.lead_id IS NOT NULL
  AND nullif(btrim(a.de_donde_vino), '') IS NULL
  AND origen_del_lead(a.lead_id) IS NOT NULL;
