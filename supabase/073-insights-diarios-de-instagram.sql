-- =====================================================
-- 073 · INSIGHTS DIARIOS DE LA CUENTA DE INSTAGRAM + SEGUIDORES COMO CORRECCIÓN
-- =====================================================
-- Problema que resuelve: en Analítica > Registro de métricas, VIEWS HISTORIAS
-- salía 0 en agosto y septiembre de 2026 y SEGUIDORES + salía 0 en todos los
-- meses (con % SEGUID. = 0,0 %).
--
-- 1) VISTAS DE HISTORIAS. El Registro sumaba content_pieces.views de cada
--    historia. El cron de historias le pedía a Meta métricas que ya no existen
--    (taps_forward, taps_back, exits), Meta rechazaba la llamada entera y las
--    50 historias guardadas quedaron con views = 0. Ese cron ya se arregló,
--    pero lo perdido no se recupera: pasadas 24 h Meta ya no entrega la
--    historia (error_subcode 33).
--
--    Donde sí hay historial es en los insights A NIVEL DE CUENTA: la métrica
--    `views` con breakdown=media_product_type trae una fila STORY por día,
--    incluso de meses atrás. Esta tabla guarda una fila por cliente y día con
--    ese desglose. El Registro usa views_story de aquí cuando el día tiene
--    fila, y solo cae a sumar content_pieces cuando no la tiene (una sola
--    fuente por día, para no contar dos veces).
--
-- 2) SEGUIDORES +. No tenía ninguna fuente automática: solo existía
--    client_metrics.followers_gained, escrito a mano, y nadie lo llenó nunca.
--    `follows_and_unfollows` con breakdown=follow_type trae historial y su
--    valor FOLLOWER coincide exacto con follower_count. Se guardan los
--    follows brutos (FOLLOWER) y los unfollows (NON_FOLLOWER) por separado; la
--    tabla muestra los brutos.
--
--    Se descartó `follower_count`: solo cubre los últimos 30 días sin contar
--    hoy, así que no sirve para rellenar julio ni agosto.
--
--    followers_count es la foto del total de seguidores del momento
--    (GET /{ig}?fields=followers_count). Solo se puede tomar de aquí en
--    adelante: en las filas rellenadas hacia atrás queda NULL.
--
-- OJO CON EL DÍA: `day` es el día calendario de Meta, que agrupa en hora del
-- Pacífico (America/Los_Angeles), no en hora de Chile. En la vista Diario hay
-- un corrimiento de unas horas en el borde de cada día; en Semanal y Mensual
-- es despreciable. Se guarda la fecha de Meta tal cual en vez de inventar un
-- reparto por horas que Meta no entrega.
--
-- 3) followers_gained PASA A SER UNA CORRECCIÓN. Con Meta como valor
--    automático, client_metrics.followers_gained se usa igual que el resto de
--    los campos del Diario: NULL = automático, un número = corrección. Pero la
--    columna tenía DEFAULT 0, así que cualquier fila creada al corregir OTRO
--    campo nacía con 0 seguidores y taparía el dato de Meta. Por eso se quita
--    el DEFAULT y los 0 existentes pasan a NULL (en producción son 2 filas, las
--    dos en 0 y ninguna escrita a propósito). El código trata un 0 como "sin
--    corrección" mientras esta migración no esté aplicada, y usa la existencia
--    de ig_account_daily_insights como señal de que ya lo está: por eso las
--    tres partes van en el mismo archivo.
--
-- 4) CAPTURA DIARIA. La ruta /api/cron/sync-instagram-insights vuelve a pedir
--    los últimos 3 días completos (los datos de Meta se asientan en 24-48 h) y
--    se agenda una vez al día con pg_cron, igual que 056. Se descartó subir la
--    frecuencia: un dato de cuenta por día no cambia cada dos horas, y el día
--    en curso lo siguen cubriendo las historias sueltas del cron de historias.
--
-- REQUISITO: 037-pg-cron-scheduler.sql aplicado, con los dos secretos en
-- Vault. El bloque 4 lo verifica y avisa en vez de agendar un job que fallaría
-- en silencio todos los días.
--
-- Idempotente: se puede correr dos veces sin error ni efectos repetidos.

-- 1) Tabla ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ig_account_daily_insights (
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  day             DATE NOT NULL,
  views_story     INTEGER,
  views_reel      INTEGER,
  views_post      INTEGER,
  views_carousel  INTEGER,
  views_total     INTEGER,
  follows         INTEGER,
  unfollows       INTEGER,
  followers_count INTEGER,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, day)
);

COMMENT ON TABLE ig_account_daily_insights IS
  'Insights diarios de la cuenta de Instagram del cliente (Meta, metric_type=total_value). day = día calendario de Meta, en hora del Pacífico. Lo llena /api/cron/sync-instagram-insights.';
COMMENT ON COLUMN ig_account_daily_insights.views_story IS
  'Vistas ocurridas ese día en historias (views, breakdown media_product_type = STORY). NULL = Meta no devolvió el dato.';
COMMENT ON COLUMN ig_account_daily_insights.views_post IS
  'Vistas ese día en publicaciones de tipo POST (media_product_type = POST).';
COMMENT ON COLUMN ig_account_daily_insights.views_carousel IS
  'Vistas ese día en carruseles (media_product_type = CAROUSEL_CONTAINER).';
COMMENT ON COLUMN ig_account_daily_insights.follows IS
  'Seguidores nuevos brutos del día (follows_and_unfollows, follow_type = FOLLOWER). Es lo que muestra Seguidores +.';
COMMENT ON COLUMN ig_account_daily_insights.unfollows IS
  'Dejaron de seguir ese día (follows_and_unfollows, follow_type = NON_FOLLOWER).';
COMMENT ON COLUMN ig_account_daily_insights.followers_count IS
  'Foto del total de seguidores tomada ese día. NULL en los días rellenados hacia atrás.';

-- La PK (client_id, day) ya sirve para "un cliente entre dos fechas", que es
-- la única consulta que se hace sobre esta tabla. No hace falta otro índice.

-- 2) RLS ─────────────────────────────────────────────────────────────────────
-- Mismo esquema que content_pieces: la agencia lee y escribe todo; el portal
-- del cliente solo lee lo suyo. El cron escribe con la service role, que no
-- pasa por RLS. Las funciones van envueltas en (SELECT ...) para que Postgres
-- las evalúe una vez por consulta y no una vez por fila (ver 072).
ALTER TABLE ig_account_daily_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agency_full_access" ON ig_account_daily_insights;
CREATE POLICY "agency_full_access" ON ig_account_daily_insights
  FOR ALL
  USING ((SELECT get_user_type()) = 'agency')
  WITH CHECK ((SELECT get_user_type()) = 'agency');

DROP POLICY IF EXISTS "client_own_data" ON ig_account_daily_insights;
CREATE POLICY "client_own_data" ON ig_account_daily_insights
  FOR SELECT
  USING ((SELECT get_user_type()) = 'client' AND client_id = (SELECT get_user_client_id()));

-- anon no tiene nada que hacer aquí (mismo criterio que 077). authenticated
-- recibe lo justo; RLS decide qué filas ve cada uno.
REVOKE ALL ON ig_account_daily_insights FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ig_account_daily_insights TO authenticated;

-- 3) followers_gained como corrección ────────────────────────────────────────
-- DROP DEFAULT es idempotente por naturaleza (no falla si ya no hay default).
-- El UPDATE solo toca los 0: una segunda corrida no encuentra nada.
ALTER TABLE client_metrics ALTER COLUMN followers_gained DROP DEFAULT;
UPDATE client_metrics SET followers_gained = NULL WHERE followers_gained = 0;

COMMENT ON COLUMN client_metrics.followers_gained IS
  'Corrección manual de Seguidores + (solo period_type = daily). NULL = usar el valor de Meta (ig_account_daily_insights.follows).';

-- 4) Captura diaria ──────────────────────────────────────────────────────────
-- 10:30 UTC = 07:30 en Chile en verano (06:30 en invierno) y 03:30 en el
-- Pacífico: el día anterior de Meta ya cerró. No choca con sync-instagram
-- (08:00 UTC, Vercel) ni con las corridas pares del cron de historias.
--
-- Primero se desagenda si ya existe, para que correr el archivo dos veces deje
-- exactamente un job con este horario aunque se haya cambiado a mano.
DO $$
BEGIN
  IF to_regprocedure('private.call_cron_endpoint(text)') IS NULL THEN
    RAISE NOTICE 'Falta private.call_cron_endpoint: aplica 037-pg-cron-scheduler.sql antes de agendar el sync de insights. No se agendó nada.';
  ELSE
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-instagram-insights') THEN
      PERFORM cron.unschedule('sync-instagram-insights');
    END IF;
    PERFORM cron.schedule(
      'sync-instagram-insights',
      '30 10 * * *',
      $cmd$ SELECT private.call_cron_endpoint('/api/cron/sync-instagram-insights') $cmd$
    );
    RAISE NOTICE 'Agendado sync-instagram-insights todos los días a las 10:30 UTC.';
  END IF;
END;
$$;

-- ── Después de aplicar ──────────────────────────────────────────────────────
-- Verificar que quedó agendado:
--   SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'sync-instagram-insights';
--
-- Rellenar el historial en tramos de 15 días como máximo (una llamada por
-- tramo; conviene revisar primero con dry=1):
--   SELECT private.call_cron_endpoint('/api/cron/sync-instagram-insights?since=2026-06-01&until=2026-06-15&dry=1');
--   SELECT private.call_cron_endpoint('/api/cron/sync-instagram-insights?since=2026-06-01&until=2026-06-15');
--
-- Y que el cron escribió:
--   SELECT created_at, summary FROM cron_runs
--   WHERE job_name = 'sync-instagram-insights' ORDER BY created_at DESC LIMIT 5;
--   SELECT day, views_story, follows, unfollows, followers_count
--   FROM ig_account_daily_insights ORDER BY day DESC LIMIT 10;
--
-- Para desagendar:
--   SELECT cron.unschedule('sync-instagram-insights');
