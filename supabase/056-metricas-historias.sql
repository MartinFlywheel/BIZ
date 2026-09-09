-- =====================================================
-- MÉTRICAS DE HISTORIAS — columnas propias y captura frecuente
-- =====================================================
-- Problema que resuelve: en el CRM no había forma de ver los números de una
-- historia. Dos causas distintas, las dos atacadas acá.
--
-- 1) LA MITAD DEL DATO SE BOTABA. El cron /api/cron/sync-instagram-stories ya
--    le pedía a Meta "views, reach, replies, taps_forward, taps_back, exits,
--    total_interactions". Llegaban los siete y se guardaban cuatro: no había
--    dónde escribir los taps ni las salidas, y las respuestas se metían en la
--    columna `comments` porque era "lo más parecido que existía".
--
--    Se descartó seguir reusando `comments`: en una historia una respuesta es
--    un DM privado, no un comentario público, y mezclarlas ensucia los
--    agregados de engagement que suman esa columna para reels y posts. Las
--    columnas nuevas llevan prefijo `story_` para que quede explícito que solo
--    aplican a content_type = 'story'.
--
--    Por compatibilidad, el cron sigue escribiendo las respuestas TAMBIÉN en
--    `comments` — hay vistas y agregados que ya leen de ahí y romperlos no era
--    parte de este arreglo.
--
-- 2) LA FOTO SE TOMABA EN EL PEOR MOMENTO. Meta borra la historia de
--    /stories a las 24h y no ofrece consulta histórica: lo que no se capturó
--    antes de que expire, se perdió para siempre. Con una sola corrida diaria
--    (tope de Vercel Hobby, ver 037-pg-cron-scheduler.sql), una historia
--    publicada poco antes de esa hora quedaba retratada con una hora de vida
--    —prácticamente en cero— y nunca se volvía a medir. De ahí el "0 vistas"
--    congelado.
--
--    Se descartó subir de plan. pg_cron ya está instalado y el helper
--    private.call_cron_endpoint ya existe desde 037: agendar la misma ruta
--    cada dos horas no cuesta nada y deja la última foto a lo más a dos horas
--    del vencimiento.
--
-- REQUISITO: 037-pg-cron-scheduler.sql tiene que estar aplicado y con los dos
-- secretos cargados en Vault. El bloque 2 de este archivo lo verifica y avisa
-- en vez de agendar un job que fallaría en silencio cada dos horas.

-- 1) Columnas ────────────────────────────────────────────────────────────────
ALTER TABLE content_pieces ADD COLUMN IF NOT EXISTS story_replies INTEGER DEFAULT 0;
ALTER TABLE content_pieces ADD COLUMN IF NOT EXISTS story_taps_forward INTEGER DEFAULT 0;
ALTER TABLE content_pieces ADD COLUMN IF NOT EXISTS story_taps_back INTEGER DEFAULT 0;
ALTER TABLE content_pieces ADD COLUMN IF NOT EXISTS story_exits INTEGER DEFAULT 0;

COMMENT ON COLUMN content_pieces.story_replies IS
  'Respuestas por DM a la historia (metric "replies" de Meta). Solo content_type = story.';
COMMENT ON COLUMN content_pieces.story_taps_forward IS
  'Toques para saltar a la historia siguiente. Solo content_type = story.';
COMMENT ON COLUMN content_pieces.story_taps_back IS
  'Toques para volver a la historia anterior. Solo content_type = story.';
COMMENT ON COLUMN content_pieces.story_exits IS
  'Salidas: cerraron las historias en esta. Solo content_type = story.';

-- Rescate del dato viejo: las respuestas que hasta ahora se guardaban en
-- `comments` se copian a su columna. Solo cuando la nueva está vacía, así que
-- correr el archivo dos veces no pisa nada.
UPDATE content_pieces
SET story_replies = comments
WHERE content_type = 'story'
  AND comments > 0
  AND COALESCE(story_replies, 0) = 0;

-- 2) Captura cada dos horas ──────────────────────────────────────────────────
-- cron.schedule reemplaza el job si ya existe uno con el mismo nombre, así que
-- el bloque es idempotente. Si 037 no está aplicado, no agenda nada y lo dice.
DO $$
BEGIN
  IF to_regprocedure('private.call_cron_endpoint(text)') IS NULL THEN
    RAISE NOTICE 'Falta private.call_cron_endpoint: aplica 037-pg-cron-scheduler.sql antes de agendar el sync de historias. No se agendó nada.';
  ELSE
    PERFORM cron.schedule(
      'sync-instagram-stories',
      '0 */2 * * *',
      $cmd$ SELECT private.call_cron_endpoint('/api/cron/sync-instagram-stories') $cmd$
    );
    RAISE NOTICE 'Agendado sync-instagram-stories cada 2 horas.';
  END IF;
END;
$$;

-- ── Después de aplicar ──────────────────────────────────────────────────────
-- Verificar que quedó agendado y que la ruta responde 200:
--   SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'sync-instagram-stories';
--   SELECT jobid, status, return_message, start_time
--   FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;
--   SELECT id, status_code, created FROM net._http_response ORDER BY id DESC LIMIT 5;
--
-- Y que el cron efectivamente escribió:
--   SELECT created_at, summary FROM cron_runs
--   WHERE job_name = 'sync-instagram-stories' ORDER BY created_at DESC LIMIT 5;
--
-- Recién cuando esas tres consultas se vean bien, se puede sacar la entrada
-- "/api/cron/sync-instagram-stories" de vercel.json. Mientras tanto conviven
-- las dos: la corrida de Vercel es idempotente (hace UPDATE por ig_media_id),
-- así que duplicarla una vez al día no rompe nada, y deja una red por si
-- pg_cron no quedó bien configurado.
--
-- Para desagendar:
--   SELECT cron.unschedule('sync-instagram-stories');
