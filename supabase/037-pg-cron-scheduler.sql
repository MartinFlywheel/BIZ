-- =====================================================
-- SCHEDULER PROPIO CON pg_cron — sin depender del plan de Vercel
-- =====================================================
-- Vercel Hobby invoca cada cron job UNA VEZ AL DÍA. Confirmado en el panel de
-- Usage: 7 jobs declarados en vercel.json = 7 invocaciones diarias, planas
-- desde que se agregó el último. El tope que molesta no es la cantidad, es la
-- frecuencia.
--
-- Eso alcanza para los sincronizadores nocturnos (Instagram, tokens,
-- benchmarks, prune), pero no para el barrido de triaje: los vencimientos y
-- los snoozes cumplidos hay que detectarlos cada 15 minutos, no una vez al
-- día.
--
-- pg_cron corre dentro de Postgres: sin límite de frecuencia, sin costo, sin
-- servicio nuevo. Y como TODAS las rutas de /api/cron ya validan
-- "Authorization: Bearer ${CRON_SECRET}", se las puede llamar desde acá sin
-- tocar una línea de código de la app.
--
-- ORDEN: correr 032-cron-runs-log.sql ANTES que este archivo. Sin la tabla
-- cron_runs no hay forma de saber si un job agendado acá terminó bien.
--
-- OJO ZONA HORARIA: pg_cron interpreta los horarios en UTC. Un '0 8 * * *'
-- acá NO son las 8am de Lima/Bogotá. Para horarios locales hay que restar el
-- offset (UTC-5 → '0 13 * * *' para las 8am).

-- 1) Extensiones ─────────────────────────────────────────────────────────────
-- Ambas están disponibles en el plan Free de Supabase. También se pueden
-- activar desde el panel: Database → Extensions.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2) Esquema privado ─────────────────────────────────────────────────────────
-- La función que sigue lee el CRON_SECRET y llama a rutas autenticadas. Si
-- viviera en "public", PostgREST la expondría como RPC y CUALQUIER usuario
-- logueado podría invocarla — incluyendo /api/cron/prune-stale-leads, que
-- borra leads. Supabase solo expone "public", así que un esquema aparte la
-- deja fuera del alcance de la API REST.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- 3) Secretos en Vault ───────────────────────────────────────────────────────
-- cron.job guarda el comando del job en texto plano y es legible por varios
-- roles, así que el token NO debe quedar escrito en la definición del job.
--
-- REEMPLAZAR los dos valores antes de correr. Si el secreto ya existe, este
-- insert falla por nombre duplicado — en ese caso usar vault.update_secret().
SELECT vault.create_secret(
  'PEGAR_AQUI_EL_VALOR_DE_CRON_SECRET',
  'cron_secret',
  'Bearer token que valida las rutas /api/cron/*'
);

SELECT vault.create_secret(
  'https://app.salesgrowthbizz.com',
  'app_base_url',
  'Origen del deployment de produccion — sin barra final'
);

-- 4) Helper para llamar una ruta de /api/cron ────────────────────────────────
-- Devuelve el id de la petición de pg_net; la respuesta llega asincrónica a
-- net._http_response. pg_net no bloquea, así que el job termina en
-- milisegundos aunque la ruta tarde 30 segundos.
CREATE OR REPLACE FUNCTION private.call_cron_endpoint(path TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, vault, net, public
AS $$
DECLARE
  base_url TEXT;
  secret   TEXT;
  req_id   BIGINT;
BEGIN
  SELECT decrypted_secret INTO base_url FROM vault.decrypted_secrets WHERE name = 'app_base_url';
  SELECT decrypted_secret INTO secret   FROM vault.decrypted_secrets WHERE name = 'cron_secret';

  IF base_url IS NULL OR secret IS NULL THEN
    RAISE EXCEPTION 'Faltan los secretos app_base_url / cron_secret en Vault';
  END IF;

  SELECT net.http_get(
    url                  := base_url || path,
    headers              := jsonb_build_object('Authorization', 'Bearer ' || secret),
    timeout_milliseconds := 30000
  ) INTO req_id;

  RETURN req_id;
END;
$$;

REVOKE ALL ON FUNCTION private.call_cron_endpoint(TEXT) FROM PUBLIC, anon, authenticated;

-- 5) Verificación ────────────────────────────────────────────────────────────
-- Correr estas dos consultas A MANO después de aplicar el archivo. Prueban
-- que pg_net alcanza el deployment y que el token viaja bien, ANTES de
-- agendar nada que dependa de eso.
--
--   SELECT private.call_cron_endpoint('/api/debug/cron-runs');
--   -- esperar ~2 segundos
--   SELECT id, status_code, content FROM net._http_response ORDER BY id DESC LIMIT 1;
--
-- status_code 200 → funciona. (Ese endpoint no exige token, así que un 200
-- prueba conectividad; para probar el token, usar una ruta de /api/cron una
-- vez que exista una que no tenga efectos secundarios.)

-- 6) El barrido de triaje ────────────────────────────────────────────────────
-- COMENTADO A PROPÓSITO: la ruta /api/cron/triage-sweep y la tabla
-- system_tasks todavía no existen. Un job agendado contra un endpoint
-- inexistente sería un 404 cada 15 minutos, ensuciando net._http_response sin
-- que nadie se entere. Descomentar recién cuando la ruta esté desplegada.
--
--   SELECT cron.schedule(
--     'triage-sweep',
--     '*/15 * * * *',
--     $cmd$ SELECT private.call_cron_endpoint('/api/cron/triage-sweep') $cmd$
--   );

-- ── Operación ───────────────────────────────────────────────────────────────
-- Ver qué hay agendado:
--   SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;
--
-- Ver las últimas corridas (esto lo escribe pg_cron solo, no hace falta log
-- propio para saber si el job arrancó):
--   SELECT jobid, status, return_message, start_time
--   FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
--
-- Ver las respuestas HTTP que devolvieron las rutas llamadas:
--   SELECT id, status_code, created FROM net._http_response ORDER BY id DESC LIMIT 20;
--
-- Desagendar:
--   SELECT cron.unschedule('triage-sweep');
