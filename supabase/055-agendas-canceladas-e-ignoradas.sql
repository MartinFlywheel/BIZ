-- Cancelar en Calendly y borrar a mano tienen que significar algo
--
-- DOS PROBLEMAS QUE APARECIERON AL PROBARLO
--
-- 1) Cancelar la reserva en Calendly no hacia nada visible. El sync solo
--    escribia "Cancelada en Calendly." en comentarios: la agenda seguia
--    contando como pendiente y el popup de triaje seguia pidiendo el
--    Instagram de una llamada que ya no existe.
--
-- 2) Borrar la agenda a mano desde la planilla no servia de nada. Al borrarla
--    desaparecia el google_event_id de la base, asi que en la vuelta siguiente
--    el sync veia el evento en el calendario, no encontraba fila y la creaba de
--    nuevo. Diez minutos despues estaba de vuelta, con un triaje nuevo.
--
-- COMO SE RESUELVEN
--
-- Para lo primero, una fecha de cancelacion. No se borra la fila: una llamada
-- cancelada es informacion (cuenta para el show rate y para saber cuantas se
-- caen), y borrarla haria que las metricas mientan hacia arriba.
--
-- Para lo segundo, una lapida. Al borrar una agenda que vino del calendario se
-- guarda su google_event_id en una tabla aparte, y el sync no vuelve a crear
-- nada para ese evento. Va por trigger y no desde el codigo para que cubra
-- cualquier via de borrado, incluido un DELETE escrito a mano en el editor SQL.
--
-- Idempotente.

ALTER TABLE agenda_records ADD COLUMN IF NOT EXISTS cancelada_at TIMESTAMPTZ;

COMMENT ON COLUMN agenda_records.cancelada_at IS
  'Cuando la reserva se cancelo en Calendly. La fila se conserva a proposito: una llamada caida es un dato, no un error.';

-- Eventos del calendario que no deben volver a entrar al CRM.
CREATE TABLE IF NOT EXISTS agenda_eventos_ignorados (
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  google_event_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, google_event_id)
);

COMMENT ON TABLE agenda_eventos_ignorados IS
  'Lapidas: eventos de Google cuya agenda se borro a mano. El sync los saltea para no resucitarlas cada 10 minutos.';

/**
 * Deja la lapida al borrar una agenda que vino del calendario.
 *
 * SECURITY DEFINER porque el trigger tiene que poder escribir en la tabla de
 * lapidas aunque quien borro la agenda no tenga permiso directo sobre ella; sin
 * eso el borrado fallaria para un setter y la agenda seria imborrable.
 */
CREATE OR REPLACE FUNCTION marcar_evento_ignorado()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.google_event_id IS NOT NULL THEN
    INSERT INTO agenda_eventos_ignorados (client_id, google_event_id)
    VALUES (OLD.client_id, OLD.google_event_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_marcar_evento_ignorado ON agenda_records;
CREATE TRIGGER trg_marcar_evento_ignorado
  BEFORE DELETE ON agenda_records
  FOR EACH ROW EXECUTE FUNCTION marcar_evento_ignorado();

ALTER TABLE agenda_eventos_ignorados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "eventos ignorados lectura" ON agenda_eventos_ignorados;
CREATE POLICY "eventos ignorados lectura" ON agenda_eventos_ignorados
  FOR SELECT TO authenticated USING (true);

-- ── Limpiar la prueba ───────────────────────────────────────────────────────
-- Para sacar de una vez la agenda de prueba y que no vuelva:
--
--   DELETE FROM agenda_records
--   WHERE nombre_lead = 'ejemplo' AND google_event_id IS NOT NULL;
--
-- El trigger deja la lapida solo, asi que el sync ya no la recrea. La tarea de
-- triaje se va sola por el ON DELETE CASCADE de system_tasks.
