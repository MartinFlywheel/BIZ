-- Línea de tiempo del lead: un registro de cambios que sobrevive al borrado
--
-- EL PROBLEMA
-- "¿Qué hizo este lead?" no tenía respuesta. La historia de cada persona está
-- repartida en ocho tablas que se unen por claves distintas (lead_id,
-- ig_username, agenda_record_id, el payload de ManyChat) y varias transiciones
-- se sobrescriben sin dejar rastro:
--
-- - lead_activity_logs es el único historial de etapas y solo se escribe desde
--   tres acciones del CRM con sesión de usuario. Lo que mueven agenda-sync, el
--   webhook de Calendly o la API del agente no queda. Tampoco puede quedar:
--   user_id es NOT NULL y action_type solo acepta 'contacto' y 'seguimiento'.
-- - Los cambios de setter (assigned_to), de etiquetas (leads.events), los
--   reagendamientos y los cambios de estado de la agenda se pisan.
-- - prune-stale-leads borra leads, y todo lo que cuelga de ellos se va con
--   ON DELETE CASCADE, historial incluido.
--
-- QUÉ SE AGREGA
--
-- lead_events                   Un evento por cambio real. lead_id va SIN
--                               foreign key a leads a propósito: si el lead se
--                               borra, sus eventos (incluido el de borrado, con
--                               una foto del lead) se quedan. client_id sí
--                               tiene FK en cascada: borrar un cliente entero
--                               sí debe llevarse su historia.
-- registrar_evento_lead()       Trigger en leads: alta, etapa, setter,
--                               etiquetas y borrado.
-- registrar_evento_agenda()     Trigger en agenda_records: agenda creada,
--                               reagendada, cambio de estado, cancelación,
--                               asociación a un lead y borrado. El borrado no
--                               estaba en el pedido original, pero una agenda
--                               arrastra datos de venta (montos, closer) y hoy
--                               se va en cascada con el lead.
-- webhook_logs.lead_id          Para cruzar cada llamada de ManyChat con su
--                               lead sin escanear el payload JSON. Quien
--                               escribe webhook_logs la irá llenando; mientras
--                               tanto la línea de tiempo cae al cruce por
--                               payload->>'ig_username' (con índice propio).
-- buscar_personas()             Búsqueda por nombre, @IG, correo o teléfono
--                               en leads y en agenda_records (donde viven casi
--                               todos los correos: leads casi no los tiene).
--
-- POR QUÉ SECURITY DEFINER EN LOS TRIGGERS
-- La convención del proyecto es SECURITY INVOKER. Aquí no sirve: con INVOKER,
-- el trigger escribe con los permisos de quien movió el lead, así que habría
-- que abrir una política de INSERT en lead_events para authenticated, y
-- cualquiera con sesión podría fabricar eventos desde el navegador. Es el
-- mismo motivo que marcar_evento_ignorado() en la 055. Se fija
-- search_path = public y la tabla no tiene ninguna política de escritura.
--
-- NUNCA BLOQUEA EL CAMBIO REAL
-- Todo el registro va dentro de BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE
-- WARNING. Un fallo aquí (una FK, un JSON raro) pierde el evento, no el UPDATE
-- del webhook de ManyChat ni el sync de agendas.
--
-- ORIGEN DEL CAMBIO
-- actor_id = auth.uid(). origen: 'sistema' si la llamada vino con la
-- service_role (webhooks, crons, sync), 'crm' si vino con sesión de usuario y
-- 'sql' si no hay JWT (editor SQL, migraciones masivas como la 067). Si el
-- servidor manda el header x-origen con la service_role, se usa ese valor
-- (por ejemplo 'agenda-sync'). Solo se acepta con service_role: desde el
-- navegador cualquiera podría mandarlo.
--
-- DESCARTADO
-- - pg_trgm: está disponible pero no instalado, y con ~8 mil leads un ILIKE
--   responde bien. Se evalúa cuando la búsqueda se sienta lenta.
-- - Copiar lead_activity_logs a lead_events: la línea de tiempo lee esa tabla
--   directamente para lo anterior al primer evento, sin duplicar datos.
-- - Registrar las notas por trigger: el autoguardado del CRM escribe cada 800
--   ms y llenaría la tabla de ruido.
--
-- Nadie la aplica sola: hay que correrla en el editor SQL de Supabase. El
-- código que la usa degrada si todavía no existe (42P01, 42703, PGRST202).
--
-- Idempotente.

-- ── Tabla ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lead_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  ig_username TEXT,
  tipo TEXT NOT NULL,
  desde TEXT,
  hasta TEXT,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  origen TEXT,
  datos JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE lead_events IS
  'Historial de cambios del lead (etapa, setter, etiquetas, agendas, borrado). Lo escriben solo los triggers; sin FK a leads para sobrevivir al borrado.';
COMMENT ON COLUMN lead_events.tipo IS
  'creado | etapa | asignacion | etiquetas | eliminado | agenda_creada | agenda_reagendada | agenda_estado | agenda_cancelada | agenda_reactivada | agenda_asociada | agenda_desasociada | agenda_eliminada';
COMMENT ON COLUMN lead_events.origen IS
  'sistema (service_role) | crm (sesión de usuario) | sql (sin JWT) | el valor del header x-origen si lo manda el servidor.';

CREATE INDEX IF NOT EXISTS idx_lead_events_lead
  ON lead_events(lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_events_client
  ON lead_events(client_id, created_at DESC);

-- Los eventos de una agenda que todavía no tenía lead se recuperan por el id
-- de la agenda cuando después se asocia.
CREATE INDEX IF NOT EXISTS idx_lead_events_agenda
  ON lead_events((datos->>'agenda_id'))
  WHERE (datos->>'agenda_id') IS NOT NULL;

ALTER TABLE lead_events ENABLE ROW LEVEL SECURITY;

-- Solo lectura para la agencia. Sin política de INSERT/UPDATE/DELETE: el
-- registro no se puede fabricar ni corregir desde el navegador.
DROP POLICY IF EXISTS "lead_events lectura agencia" ON lead_events;
CREATE POLICY "lead_events lectura agencia" ON lead_events
  FOR SELECT TO authenticated
  USING ((SELECT get_user_type()) = 'agency');

REVOKE INSERT, UPDATE, DELETE ON lead_events FROM anon, authenticated;

-- ── Contexto del cambio: quién y desde dónde ────────────────────────────────

/**
 * Actor y origen del cambio en curso.
 *
 * Se llama desde los triggers (que corren como dueño), así que no necesita
 * SECURITY DEFINER propio. El actor se descarta si no existe en users: sin eso
 * la FK tumbaría el evento entero.
 */
CREATE OR REPLACE FUNCTION contexto_evento_lead(OUT p_actor UUID, OUT p_origen TEXT)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_rol TEXT;
  v_header TEXT;
BEGIN
  p_actor := auth.uid();
  v_rol := auth.role();

  IF p_actor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = p_actor) THEN
    p_actor := NULL;
  END IF;

  p_origen := CASE
    WHEN v_rol = 'service_role' THEN 'sistema'
    WHEN v_rol IS NULL THEN 'sql'
    ELSE 'crm'
  END;

  IF v_rol = 'service_role' THEN
    BEGIN
      v_header := NULLIF(current_setting('request.headers', true), '')::json->>'x-origen';
      IF NULLIF(btrim(v_header), '') IS NOT NULL THEN
        p_origen := left(btrim(v_header), 40);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- header ausente o JSON inválido: se queda 'sistema'
    END;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION contexto_evento_lead() FROM PUBLIC, anon, authenticated;

-- Fechas como ISO 8601 en UTC, para que el navegador las lea sin ambigüedad
-- (el texto por defecto de un timestamptz depende del TimeZone de la sesión).
CREATE OR REPLACE FUNCTION iso_utc_evento(p_ts TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT to_char(p_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;

REVOKE EXECUTE ON FUNCTION iso_utc_evento(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ── Trigger en leads ────────────────────────────────────────────────────────

/**
 * Registra alta, etapa, setter, etiquetas y borrado de un lead.
 *
 * SECURITY DEFINER: ver el encabezado. Solo escribe si el valor cambió de
 * verdad (IS DISTINCT FROM): el CRM a veces manda el mismo valor de vuelta.
 */
CREATE OR REPLACE FUNCTION registrar_evento_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx RECORD;
  v_agregadas TEXT[];
  v_quitadas TEXT[];
BEGIN
  BEGIN
    SELECT * INTO v_ctx FROM contexto_evento_lead();

    IF TG_OP = 'INSERT' THEN
      INSERT INTO lead_events (lead_id, client_id, ig_username, tipo, hasta, actor_id, origen, datos)
      VALUES (
        NEW.id, NEW.client_id, NEW.ig_username, 'creado', NEW.stage, v_ctx.p_actor, v_ctx.p_origen,
        jsonb_strip_nulls(jsonb_build_object(
          'first_touch_type', NEW.first_touch_type,
          'assigned_to', NEW.assigned_to,
          'full_name', NEW.full_name
        ))
      );

    ELSIF TG_OP = 'DELETE' THEN
      -- La foto del lead al momento de borrarlo: es lo único que va a quedar.
      INSERT INTO lead_events (lead_id, client_id, ig_username, tipo, desde, actor_id, origen, datos)
      VALUES (
        OLD.id, OLD.client_id, OLD.ig_username, 'eliminado', OLD.stage, v_ctx.p_actor, v_ctx.p_origen,
        jsonb_strip_nulls(jsonb_build_object(
          'full_name', OLD.full_name,
          'stage', OLD.stage,
          'first_touch_type', OLD.first_touch_type,
          'first_touch_at', OLD.first_touch_at,
          'assigned_to', OLD.assigned_to,
          'lead_created_at', OLD.created_at,
          'agenda_at', OLD.agenda_at,
          'closed_at', OLD.closed_at
        ))
      );

    ELSE
      IF NEW.stage IS DISTINCT FROM OLD.stage THEN
        INSERT INTO lead_events (lead_id, client_id, ig_username, tipo, desde, hasta, actor_id, origen)
        VALUES (NEW.id, NEW.client_id, NEW.ig_username, 'etapa', OLD.stage, NEW.stage, v_ctx.p_actor, v_ctx.p_origen);
      END IF;

      IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
        INSERT INTO lead_events (lead_id, client_id, ig_username, tipo, desde, hasta, actor_id, origen)
        VALUES (NEW.id, NEW.client_id, NEW.ig_username, 'asignacion', OLD.assigned_to::text, NEW.assigned_to::text, v_ctx.p_actor, v_ctx.p_origen);
      END IF;

      IF NEW.events IS DISTINCT FROM OLD.events THEN
        v_agregadas := ARRAY(
          SELECT unnest(COALESCE(NEW.events, '{}'::text[]))
          EXCEPT
          SELECT unnest(COALESCE(OLD.events, '{}'::text[]))
        );
        v_quitadas := ARRAY(
          SELECT unnest(COALESCE(OLD.events, '{}'::text[]))
          EXCEPT
          SELECT unnest(COALESCE(NEW.events, '{}'::text[]))
        );
        -- Reordenar las mismas etiquetas no es un cambio.
        IF cardinality(v_agregadas) > 0 OR cardinality(v_quitadas) > 0 THEN
          INSERT INTO lead_events (lead_id, client_id, ig_username, tipo, desde, hasta, actor_id, origen, datos)
          VALUES (
            NEW.id, NEW.client_id, NEW.ig_username, 'etiquetas',
            array_to_string(OLD.events, ', '), array_to_string(NEW.events, ', '),
            v_ctx.p_actor, v_ctx.p_origen,
            jsonb_build_object('agregadas', to_jsonb(v_agregadas), 'quitadas', to_jsonb(v_quitadas))
          );
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'registrar_evento_lead (%): % [%]', TG_OP, SQLERRM, SQLSTATE;
  END;

  RETURN NULL; -- AFTER trigger: el valor de retorno se ignora
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_events_leads ON leads;
CREATE TRIGGER trg_lead_events_leads
  AFTER INSERT OR UPDATE OF stage, assigned_to, events OR DELETE ON leads
  FOR EACH ROW EXECUTE FUNCTION registrar_evento_lead();

-- ── Trigger en agenda_records ───────────────────────────────────────────────

/**
 * Registra la vida de una agenda: creada, reagendada, cambio de estado,
 * cancelada o reactivada, asociada a un lead y borrada.
 *
 * Una agenda puede existir antes de tener lead (el sync de Google Calendar la
 * crea y el setter la asocia después). Esos eventos se guardan igual, con
 * lead_id NULL y datos.agenda_id, y la línea de tiempo los recupera por la
 * agenda.
 *
 * SECURITY DEFINER: ver el encabezado.
 */
CREATE OR REPLACE FUNCTION registrar_evento_agenda()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx RECORD;
  v_ig TEXT;
  v_fila agenda_records%ROWTYPE;
BEGIN
  BEGIN
    SELECT * INTO v_ctx FROM contexto_evento_lead();

    IF TG_OP = 'DELETE' THEN
      v_fila := OLD;
    ELSE
      v_fila := NEW;
    END IF;

    IF v_fila.lead_id IS NOT NULL THEN
      SELECT ig_username INTO v_ig FROM leads WHERE id = v_fila.lead_id;
    END IF;

    IF TG_OP = 'INSERT' THEN
      INSERT INTO lead_events (lead_id, client_id, ig_username, tipo, hasta, actor_id, origen, datos)
      VALUES (
        NEW.lead_id, NEW.client_id, v_ig, 'agenda_creada', iso_utc_evento(NEW.hora_agenda), v_ctx.p_actor, v_ctx.p_origen,
        jsonb_strip_nulls(jsonb_build_object(
          'agenda_id', NEW.id,
          'hora_agenda', iso_utc_evento(NEW.hora_agenda),
          'fecha_agenda', NEW.fecha_agenda,
          'match_metodo', NEW.match_metodo,
          'canal', CASE
            WHEN NEW.calendly_uuid IS NOT NULL THEN 'calendly'
            WHEN NEW.google_event_id IS NOT NULL THEN 'google_calendar'
            ELSE 'manual'
          END,
          'nombre_lead', NEW.nombre_lead
        ))
      );

    ELSIF TG_OP = 'DELETE' THEN
      INSERT INTO lead_events (lead_id, client_id, ig_username, tipo, desde, actor_id, origen, datos)
      VALUES (
        OLD.lead_id, OLD.client_id, v_ig, 'agenda_eliminada', OLD.estado, v_ctx.p_actor, v_ctx.p_origen,
        jsonb_strip_nulls(jsonb_build_object(
          'agenda_id', OLD.id,
          'hora_agenda', iso_utc_evento(OLD.hora_agenda),
          'fecha_agenda', OLD.fecha_agenda,
          'estado', OLD.estado,
          'nombre_lead', OLD.nombre_lead,
          'closer', OLD.closer,
          'programa_ofrecido', OLD.programa_ofrecido,
          'forma_de_cierre', OLD.forma_de_cierre,
          'monto_upfront', OLD.monto_upfront,
          'monto_facturacion', OLD.monto_facturacion
        ))
      );

    ELSE
      IF NEW.hora_agenda IS DISTINCT FROM OLD.hora_agenda THEN
        INSERT INTO lead_events (lead_id, client_id, ig_username, tipo, desde, hasta, actor_id, origen, datos)
        VALUES (
          NEW.lead_id, NEW.client_id, v_ig, 'agenda_reagendada',
          iso_utc_evento(OLD.hora_agenda), iso_utc_evento(NEW.hora_agenda), v_ctx.p_actor, v_ctx.p_origen,
          jsonb_build_object('agenda_id', NEW.id)
        );
      END IF;

      IF NEW.estado IS DISTINCT FROM OLD.estado THEN
        INSERT INTO lead_events (lead_id, client_id, ig_username, tipo, desde, hasta, actor_id, origen, datos)
        VALUES (
          NEW.lead_id, NEW.client_id, v_ig, 'agenda_estado', OLD.estado, NEW.estado, v_ctx.p_actor, v_ctx.p_origen,
          jsonb_build_object('agenda_id', NEW.id)
        );
      END IF;

      IF NEW.cancelada_at IS DISTINCT FROM OLD.cancelada_at THEN
        INSERT INTO lead_events (lead_id, client_id, ig_username, tipo, desde, hasta, actor_id, origen, datos)
        VALUES (
          NEW.lead_id, NEW.client_id, v_ig,
          CASE WHEN NEW.cancelada_at IS NULL THEN 'agenda_reactivada' ELSE 'agenda_cancelada' END,
          iso_utc_evento(OLD.cancelada_at), iso_utc_evento(NEW.cancelada_at), v_ctx.p_actor, v_ctx.p_origen,
          jsonb_build_object('agenda_id', NEW.id)
        );
      END IF;

      IF NEW.lead_id IS DISTINCT FROM OLD.lead_id THEN
        IF OLD.lead_id IS NOT NULL THEN
          INSERT INTO lead_events (lead_id, client_id, tipo, desde, hasta, actor_id, origen, datos)
          VALUES (
            OLD.lead_id, NEW.client_id, 'agenda_desasociada', OLD.lead_id::text, NEW.lead_id::text,
            v_ctx.p_actor, v_ctx.p_origen,
            jsonb_build_object('agenda_id', NEW.id)
          );
        END IF;
        IF NEW.lead_id IS NOT NULL THEN
          INSERT INTO lead_events (lead_id, client_id, ig_username, tipo, desde, hasta, actor_id, origen, datos)
          VALUES (
            NEW.lead_id, NEW.client_id, v_ig, 'agenda_asociada', OLD.lead_id::text, NEW.lead_id::text,
            v_ctx.p_actor, v_ctx.p_origen,
            jsonb_strip_nulls(jsonb_build_object('agenda_id', NEW.id, 'match_metodo', NEW.match_metodo))
          );
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'registrar_evento_agenda (%): % [%]', TG_OP, SQLERRM, SQLSTATE;
  END;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_events_agenda ON agenda_records;
CREATE TRIGGER trg_lead_events_agenda
  AFTER INSERT OR UPDATE OF hora_agenda, estado, cancelada_at, lead_id OR DELETE ON agenda_records
  FOR EACH ROW EXECUTE FUNCTION registrar_evento_agenda();

-- ── webhook_logs: cruce directo con el lead ─────────────────────────────────

ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS lead_id UUID;

COMMENT ON COLUMN webhook_logs.lead_id IS
  'Lead al que correspondió la llamada, cuando se pudo resolver. Sin FK: el log debe sobrevivir al borrado del lead.';

CREATE INDEX IF NOT EXISTS idx_webhook_logs_lead
  ON webhook_logs(lead_id, received_at)
  WHERE lead_id IS NOT NULL;

-- Mientras lead_id no esté lleno, la línea de tiempo busca las llamadas de
-- ManyChat por el usuario de Instagram del payload. Sin este índice eso es un
-- recorrido de ~24 mil payloads JSON cada vez que alguien abre un lead.
CREATE INDEX IF NOT EXISTS idx_webhook_logs_manychat_ig
  ON webhook_logs((payload->>'ig_username'), received_at)
  WHERE source = 'manychat';

-- ── interactions: cruce por usuario de Instagram sin importar mayúsculas ────

CREATE INDEX IF NOT EXISTS idx_interactions_client_lower_user
  ON interactions(client_id, lower(ig_username));

-- ── Buscador de personas ────────────────────────────────────────────────────

/**
 * Busca un lead por nombre, @IG, correo o teléfono, en leads y en las agendas.
 *
 * El correo y el teléfono casi nunca están en leads (4 correos en 8 mil leads
 * de Mane): llegan con la reserva, así que se busca también en
 * agenda_records.nombre_lead y email_lead y se devuelve el lead asociado.
 *
 * SECURITY INVOKER: las políticas RLS de leads, agenda_records y clients se
 * aplican igual que en una consulta directa. Acotar a un cliente o esconder el
 * lead calificado de otro setter lo hace la server action.
 *
 * coincidencia: instagram | nombre | correo | telefono | agenda_nombre |
 * agenda_correo. Si una persona coincide por varias vías, gana la primera de
 * esa lista.
 */
CREATE OR REPLACE FUNCTION buscar_personas(p_texto TEXT, p_client_id UUID DEFAULT NULL)
RETURNS TABLE (
  lead_id UUID,
  client_id UUID,
  client_name TEXT,
  nombre TEXT,
  ig_username TEXT,
  stage TEXT,
  coincidencia TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH q AS (
    SELECT
      btrim(coalesce(p_texto, '')) AS t,
      -- % y _ son comodines de ILIKE: se escapan para buscar el texto literal.
      '%' || replace(replace(replace(btrim(coalesce(p_texto, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' AS patron,
      '%' || replace(replace(replace(ltrim(btrim(coalesce(p_texto, '')), '@'), '\', '\\'), '%', '\%'), '_', '\_') || '%' AS patron_ig,
      regexp_replace(coalesce(p_texto, ''), '\D', '', 'g') AS digitos
  ),
  candidatos AS (
    SELECT
      l.id AS lead_id,
      CASE
        WHEN l.ig_username ILIKE q.patron_ig THEN 1
        WHEN l.full_name ILIKE q.patron THEN 2
        WHEN l.email ILIKE q.patron THEN 3
        ELSE 4
      END AS prioridad
    FROM leads l, q
    WHERE length(q.t) >= 2
      AND (p_client_id IS NULL OR l.client_id = p_client_id)
      AND (
        l.ig_username ILIKE q.patron_ig
        OR l.full_name ILIKE q.patron
        OR l.email ILIKE q.patron
        OR (
          length(q.digitos) >= 6
          AND (
            l.phone_e164 LIKE '%' || q.digitos || '%'
            OR regexp_replace(coalesce(l.phone, ''), '\D', '', 'g') LIKE '%' || q.digitos || '%'
          )
        )
      )

    UNION ALL

    SELECT
      a.lead_id,
      CASE WHEN a.email_lead ILIKE q.patron THEN 6 ELSE 5 END AS prioridad
    FROM agenda_records a, q
    WHERE length(q.t) >= 2
      AND a.lead_id IS NOT NULL
      AND (p_client_id IS NULL OR a.client_id = p_client_id)
      AND (a.nombre_lead ILIKE q.patron OR a.email_lead ILIKE q.patron)
  ),
  mejor AS (
    SELECT DISTINCT ON (c.lead_id) c.lead_id, c.prioridad
    FROM candidatos c
    ORDER BY c.lead_id, c.prioridad
  )
  SELECT
    l.id,
    l.client_id,
    cl.name,
    l.full_name,
    l.ig_username,
    l.stage,
    CASE m.prioridad
      WHEN 1 THEN 'instagram'
      WHEN 2 THEN 'nombre'
      WHEN 3 THEN 'correo'
      WHEN 4 THEN 'telefono'
      WHEN 5 THEN 'agenda_nombre'
      ELSE 'agenda_correo'
    END,
    l.updated_at
  FROM mejor m
  JOIN leads l ON l.id = m.lead_id
  LEFT JOIN clients cl ON cl.id = l.client_id
  ORDER BY m.prioridad, l.updated_at DESC NULLS LAST
  LIMIT 30
$$;

GRANT EXECUTE ON FUNCTION buscar_personas(TEXT, UUID) TO authenticated;
