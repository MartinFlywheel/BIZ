-- Grabaciones de Fathom guardadas en el CRM y pestaña Llamadas sobre las agendas
--
-- EL PROBLEMA
-- La pestaña Llamadas del cliente leía solo sales_calls, una tabla que nadie
-- llena sola: tenía 9 filas cargadas a mano el 02-08 y ninguna grabación. El
-- sync de Fathom, en cambio, escribe en agenda_records. Resultado: las
-- grabaciones existían en el CRM pero la pestaña no las mostraba nunca.
--
-- A eso se sumaba que el cruce de Fathom con las agendas descartaba toda
-- agenda sin hora (las cargadas a mano, 63 de 76 en Mane) y que una grabación
-- que no encontraba agenda no quedaba guardada en ninguna parte: si alguien
-- completaba la agenda después, nunca se volvía a intentar.
--
-- QUÉ SE DECIDIÓ
--
-- 1) agenda_records pasa a ser la fuente de verdad de las llamadas. Ya tiene
--    closer, estado, triaje, reporte y la grabación. sales_calls queda como
--    legado de solo lectura y se enlaza a su agenda cuando se puede.
--
-- 2) Tabla fathom_grabaciones: una fila por reunión que devuelve la API de
--    Fathom, esté o no asociada a una agenda. Permite reintentar el cruce, dejar
--    una sugerencia cuando no hay certeza y mostrar las "grabaciones sin agenda"
--    para asociarlas a mano.
--
--    OJO CON EL NOMBRE: ya existe 052-fathom-grabaciones.sql, que NO creó
--    ninguna tabla; solo agregó columnas fathom_* y email_lead a
--    agenda_records. Esta migración crea por primera vez una tabla con ese
--    nombre. Las columnas de la 052 se siguen usando: agenda_records sigue
--    guardando fathom_recording_id, fathom_resumen y link_reporte, que es lo
--    que lee el pipeline de reportes.
--
-- 3) sales_calls.agenda_record_id enlaza el legado con su agenda, para que la
--    pestaña no muestre dos veces la misma llamada.
--
-- 4) client_tab_counts (047) cuenta llamadas como la pestaña nueva: agendas ya
--    ocurridas (fecha en hora de Chile) y no canceladas, más grabaciones sin
--    agenda, más legado sin enlazar.
--
-- QUÉ SE DESCARTÓ
--
-- - agenda_records.carpeta_llamada_id: las carpetas de llamadas (call_folders)
--   tienen 0 filas en producción. Migrarlas a las agendas era trabajo para una
--   funcionalidad que nadie usa; la tabla call_folders se deja intacta por si
--   se retoma.
-- - clients.fathom_grabadores (correos de quienes graban por cliente): hoy hay
--   una sola FATHOM_API_KEY y un solo cliente con calendario. El cliente de
--   cada grabación se resuelve por las agendas candidatas. Cuando haya un
--   segundo cliente con grabaciones habrá que agregar esa columna o una key
--   por cliente; la limitación está documentada en fathom-sync.ts.
-- - Guardar el transcript: son miles de líneas por llamada y el CRM no lo
--   muestra en ninguna parte.
--
-- Nadie aplica esto solo: hay que pegarlo en el editor SQL de Supabase. El
-- código degrada si todavía no se corrió (42P01 / 42703).
--
-- Idempotente: se puede correr dos veces.

-- ── 1. Grabaciones de Fathom ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fathom_grabaciones (
  -- Fathom lo devuelve como número; se guarda como texto, igual que
  -- agenda_records.fathom_recording_id, para que los dos se comparen sin
  -- conversiones.
  recording_id TEXT PRIMARY KEY,
  -- NULL = todavía no se sabe de qué cliente es (ninguna agenda candidata).
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  agenda_record_id UUID REFERENCES agenda_records(id) ON DELETE SET NULL,
  titulo TEXT,
  share_url TEXT,
  url TEXT,
  scheduled_start_time TIMESTAMPTZ,
  recording_start_time TIMESTAMPTZ,
  recording_end_time TIMESTAMPTZ,
  creada_en_fathom TIMESTAMPTZ,
  grabado_por_email TEXT,
  grabado_por_nombre TEXT,
  invitados JSONB NOT NULL DEFAULT '[]'::jsonb,
  resumen TEXT,
  -- auto | manual | sugerida | desasociada | previa
  match_metodo TEXT,
  match_puntaje INT,
  -- La mejor candidata cuando el puntaje no alcanzó para asociar sola.
  sugerida_agenda_id UUID REFERENCES agenda_records(id) ON DELETE SET NULL,
  sincronizado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE fathom_grabaciones IS
  'Una fila por reunión de la API de Fathom, asociada o no a una agenda. No confundir con 052-fathom-grabaciones.sql, que solo agregó columnas a agenda_records.';
COMMENT ON COLUMN fathom_grabaciones.match_metodo IS
  'auto = la asoció el sync por puntaje | manual = alguien la asoció desde la pestaña Llamadas | sugerida = hay candidata pero sin certeza | desasociada = alguien la separó a mano y el sync no la vuelve a asociar sola | previa = ya estaba en agenda_records antes de esta tabla.';

-- Una agenda, una grabación.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fathom_grabaciones_agenda
  ON fathom_grabaciones(agenda_record_id)
  WHERE agenda_record_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fathom_grabaciones_cliente_fecha
  ON fathom_grabaciones(client_id, recording_start_time);

-- La pestaña y el reintento del sync buscan las que no tienen agenda.
CREATE INDEX IF NOT EXISTS idx_fathom_grabaciones_sin_agenda
  ON fathom_grabaciones(client_id, recording_start_time)
  WHERE agenda_record_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_fathom_grabaciones_sugerida
  ON fathom_grabaciones(sugerida_agenda_id)
  WHERE sugerida_agenda_id IS NOT NULL;

-- RLS igual que agenda_records, con las funciones envueltas en SELECT para que
-- Postgres las evalúe una vez por consulta y no una vez por fila (ver 072).
ALTER TABLE fathom_grabaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agency_full ON fathom_grabaciones;
CREATE POLICY agency_full ON fathom_grabaciones
  FOR ALL
  USING ((SELECT get_user_type()) = 'agency')
  WITH CHECK ((SELECT get_user_type()) = 'agency');

DROP POLICY IF EXISTS client_read ON fathom_grabaciones;
CREATE POLICY client_read ON fathom_grabaciones
  FOR SELECT
  USING (
    (SELECT get_user_type()) = 'client'
    AND client_id = (SELECT get_user_client_id())
  );

-- ── 2. Legado de sales_calls enlazado a su agenda ───────────────────────────

ALTER TABLE sales_calls
  ADD COLUMN IF NOT EXISTS agenda_record_id UUID REFERENCES agenda_records(id) ON DELETE SET NULL;

COMMENT ON COLUMN sales_calls.agenda_record_id IS
  'Agenda equivalente. NULL = llamada de legado sin agenda; la pestaña Llamadas la muestra aparte.';

CREATE INDEX IF NOT EXISTS idx_sales_calls_agenda
  ON sales_calls(agenda_record_id)
  WHERE agenda_record_id IS NOT NULL;

-- ── 3. Contador de la pestaña Llamadas ──────────────────────────────────────
-- Misma firma que la 047 (CREATE OR REPLACE no permite cambiar las columnas
-- que devuelve), solo cambia cómo se cuenta "calls".

CREATE OR REPLACE FUNCTION public.client_tab_counts(p_client_id UUID)
RETURNS TABLE (content_pieces BIGINT, leads BIGINT, calls BIGINT, competitors BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    (SELECT count(*) FROM content_pieces cp WHERE cp.client_id = p_client_id),
    (SELECT count(*) FROM leads l           WHERE l.client_id  = p_client_id),
    (
      -- Agendas que ya ocurrieron, con "hoy" en hora de Chile y no en UTC:
      -- desde las 21:00 el servidor ya está en el día siguiente.
      (SELECT count(*) FROM agenda_records a
        WHERE a.client_id = p_client_id
          AND a.cancelada_at IS NULL
          AND a.fecha_agenda <= (now() AT TIME ZONE 'America/Santiago')::date)
      + (SELECT count(*) FROM fathom_grabaciones g
          WHERE g.client_id = p_client_id
            AND g.agenda_record_id IS NULL)
      -- sales_calls no tiene client_id: cuelga del lead.
      + (SELECT count(*) FROM sales_calls sc
           JOIN leads l2 ON l2.id = sc.lead_id
          WHERE l2.client_id = p_client_id
            AND sc.agenda_record_id IS NULL)
    ),
    (SELECT count(*) FROM competitors c     WHERE c.client_id  = p_client_id);
$$;

GRANT EXECUTE ON FUNCTION public.client_tab_counts(UUID) TO authenticated;

COMMENT ON FUNCTION public.client_tab_counts IS
  'Los cuatro contadores de las pestañas del detalle de cliente en una sola consulta. calls = agendas ya ocurridas no canceladas + grabaciones de Fathom sin agenda + sales_calls de legado sin enlazar (074).';
