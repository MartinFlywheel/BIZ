-- =====================================================
-- 077 — RLS en las nueve tablas que quedaron abiertas
-- =====================================================
--
-- EL PROBLEMA
-- Nueve tablas de public no tenían RLS: users, webhook_logs, integrations,
-- benchmarks, sops, sync_logs, onboarding_runs, onboarding_tasks y
-- onboarding_templates (pg_class.relrowsecurity = false, verificado el
-- 2026-09-14). Además anon y authenticated tenían SELECT, INSERT, UPDATE y
-- DELETE sobre todas. La llave anon va en el bundle del navegador, así que:
--
--   - Cualquiera podía leer los ~24 mil payloads de webhook_logs (usuario de
--     Instagram, nombre, correo y teléfono de los leads) y los access_token de
--     integrations.
--   - Cualquier usuario con sesión (hay 2 client_owner y 2 setters) podía
--     ponerse user_type = 'agency' y role = 'admin' en su fila de users. Como
--     get_user_type() lee esa tabla, eso le abría los datos de todos los
--     clientes.
--   - La pantalla de login creaba un perfil 'admin' para cualquier cuenta de
--     Auth que entrara sin fila en users. Con esta migración ese insert falla:
--     los perfiles solo los crea un admin desde Equipo (service role).
--
-- INVENTARIO DE ACCESOS (grep en src/, 2026-09-14)
-- users
--   sesión: proxy (src/lib/supabase/middleware.ts) y session.ts leen la fila
--     propia; layouts de portal y setter-app, login, atv-bot-link, leads.ts,
--     lead-chat.ts, triage.ts, tasks.ts, setter-app.ts, clients.ts,
--     lead-magnet.ts leen la propia o la lista de la agencia; embeds
--     users!leads_assigned_to_fkey / users(full_name) en leads, calls, notes,
--     team_assignments y reportes del setter (todos de agencia).
--     team.ts updateAgencyUserAction escribía role/client_id con la sesión:
--     pasa al cliente admin después de validar que quien llama es admin.
--   admin (service role): manychat.ts, agent-api.ts, pipeline-agendas.ts,
--     refresh-tokens, team.ts (crear y borrar), backfills de debug.
--   base: get_user_type() y get_user_client_id() son SECURITY DEFINER con
--     dueño postgres (BYPASSRLS), así que siguen leyendo users sin RLS. Las
--     políticas EXISTS (SELECT 1 FROM users WHERE id = auth.uid() ...) de
--     competitors, competitor_reels, content_metrics, client_metrics,
--     cron_runs e incoming_messages leen la fila propia, que sigue visible.
-- webhook_logs      solo cliente admin (webhooks, crons, agent-api, debug).
-- integrations      admin en refresh-tokens; sesión en settings/page.tsx (pasa
--                   a admin con columnas sin secretos) y en
--                   content.ts quickAddLatestReels (código sin uso: nadie la
--                   importa; queda devolviendo "sin integración").
-- sync_logs         sesión en settings/page.tsx (lectura); admin escribe.
-- benchmarks        sesión en dashboard (getBenchmarkAlerts) y settings;
--                   admin en check-benchmarks.
-- sops, onboarding_* sesión en src/lib/actions/sops.ts y onboarding.ts
--                   (pantalla /sops, solo agencia); team.ts usa admin.
--
-- QUÉ SE DECIDIÓ
-- users
--   SELECT: cada usuario ve su fila; la agencia ve todas (el CRM muestra
--     nombres de setters y closers en todos lados).
--   UPDATE: la fila propia, o cualquiera si quien actualiza es admin.
--   INSERT / DELETE: solo admins (y service role, que se salta la RLS).
--   Trigger BEFORE UPDATE proteger_columnas_users: quien no es admin solo
--     puede cambiar full_name y avatar_url de su fila. Se compara la fila
--     completa como JSONB menos esas dos columnas, así una columna nueva queda
--     protegida por defecto. Una política con WITH CHECK no alcanza: no puede
--     comparar contra el valor anterior.
-- webhook_logs e integrations: RLS sin políticas. Nadie con sesión las lee;
--   el código usa el cliente admin después de validar permisos.
-- sync_logs: lectura para la agencia. Escribe solo el service role.
-- benchmarks: lectura para la agencia; escritura solo admins.
-- sops y onboarding_*: la agencia completa, igual que el resto del CRM.
-- anon pierde todos los privilegios sobre las nueve tablas, y authenticated
--   pierde TRUNCATE (no respeta RLS) y la escritura donde no hay política.
--
-- POR QUÉ es_admin() ES SECURITY DEFINER
-- La convención del proyecto es SECURITY INVOKER. Aquí no sirve: una política
-- de users que consulte users con los permisos del que llama entra en
-- recursión infinita (42P17). Es el mismo motivo por el que get_user_type()
-- es DEFINER desde el principio. Se fija search_path = public y solo devuelve
-- un booleano sobre la fila del propio auth.uid().
-- El trigger sí es SECURITY INVOKER: current_user dice si viene de la API con
-- sesión (authenticated/anon) o del service role / editor SQL, que pasan sin
-- restricción.
--
-- Se descartó:
--   - supabase/fix-users-rls.sql (sin numerar, nunca aplicado): dejaba que
--     cada usuario se insertara y se editara a sí mismo sin límite, que es
--     justo la escalada que hay que cerrar. Sus políticas se borran si
--     existieran.
--   - Restringir la lectura de users al cliente de cada persona: rompe
--     getAgencyUsers() sin cliente (/calls) y los nombres de admins en todas
--     las pestañas. Queda como endurecimiento posible.
--   - Cambiar get_user_type() a INVOKER (ver 072).
--
-- Idempotente: ENABLE RLS es repetible, DROP POLICY/TRIGGER IF EXISTS antes de
-- crear, CREATE OR REPLACE en las funciones y REVOKE/GRANT repetibles.
--
-- VALIDACIÓN ANTES DE CORRERLA EN PRODUCCIÓN
-- Probada dentro de BEGIN ... ROLLBACK con SET LOCAL role authenticated y el
-- JWT de un admin, un setter y un client_owner reales: el select del proxy,
-- session.ts y getAgencyUsers devuelven lo mismo que antes; el setter no puede
-- cambiarse el rol ni leer webhook_logs.

SELECT set_config('lock_timeout', '10s', true);

-- ── Funciones de apoyo ────────────────────────────────────────────────────

-- Endurecimiento pendiente de las funciones que ya existían: sin search_path
-- fijo, una DEFINER puede resolver "users" a otra tabla.
ALTER FUNCTION public.get_user_type() SET search_path = public;
ALTER FUNCTION public.get_user_client_id() SET search_path = public;

CREATE OR REPLACE FUNCTION public.es_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users
    WHERE id = auth.uid()
      AND user_type = 'agency'
      AND role = 'admin'
      AND is_active IS NOT FALSE
  );
$$;

REVOKE EXECUTE ON FUNCTION public.es_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.es_admin() TO authenticated;

COMMENT ON FUNCTION public.es_admin() IS
  'true si el usuario de la sesión es admin activo de la agencia. SECURITY DEFINER para usarla en políticas de users sin recursión. Ver supabase/077.';

-- ── users ─────────────────────────────────────────────────────────────────

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Las de fix-users-rls.sql, por si alguien la corrió.
DROP POLICY IF EXISTS "users_read_own" ON public.users;
DROP POLICY IF EXISTS "agency_read_all" ON public.users;
DROP POLICY IF EXISTS "users_insert_own" ON public.users;
DROP POLICY IF EXISTS "users_update_own" ON public.users;

DROP POLICY IF EXISTS users_select ON public.users;
CREATE POLICY users_select ON public.users
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT get_user_type()) = 'agency');

DROP POLICY IF EXISTS users_update ON public.users;
CREATE POLICY users_update ON public.users
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT es_admin()))
  WITH CHECK (id = (SELECT auth.uid()) OR (SELECT es_admin()));

DROP POLICY IF EXISTS users_insert_admin ON public.users;
CREATE POLICY users_insert_admin ON public.users
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT es_admin()));

DROP POLICY IF EXISTS users_delete_admin ON public.users;
CREATE POLICY users_delete_admin ON public.users
  FOR DELETE TO authenticated
  USING ((SELECT es_admin()) AND id <> (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.proteger_columnas_users()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Service role, postgres (editor SQL) y el dueño no pasan por aquí: la
  -- regla es para las sesiones que llegan por la API.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF (SELECT es_admin()) THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'full_name' - 'avatar_url') IS DISTINCT FROM (to_jsonb(OLD) - 'full_name' - 'avatar_url') THEN
    RAISE EXCEPTION 'Solo un admin puede cambiar el tipo, el rol, el cliente, el estado o el correo de un usuario'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.proteger_columnas_users() TO authenticated;

DROP TRIGGER IF EXISTS trg_proteger_columnas_users ON public.users;
CREATE TRIGGER trg_proteger_columnas_users
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.proteger_columnas_users();

REVOKE ALL ON public.users FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.users FROM authenticated;

-- ── webhook_logs e integrations: solo service role ────────────────────────

ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_logs FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.webhook_logs FROM authenticated;

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.integrations FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.integrations FROM authenticated;

-- ── sync_logs: lectura para la agencia ────────────────────────────────────

ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sync_logs FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.sync_logs FROM authenticated;

DROP POLICY IF EXISTS agency_read ON public.sync_logs;
CREATE POLICY agency_read ON public.sync_logs
  FOR SELECT TO authenticated
  USING ((SELECT get_user_type()) = 'agency');

-- ── benchmarks: lectura para la agencia, escritura para admins ────────────

ALTER TABLE public.benchmarks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.benchmarks FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.benchmarks FROM authenticated;

DROP POLICY IF EXISTS agency_read ON public.benchmarks;
CREATE POLICY agency_read ON public.benchmarks
  FOR SELECT TO authenticated
  USING ((SELECT get_user_type()) = 'agency');

DROP POLICY IF EXISTS admin_write ON public.benchmarks;
CREATE POLICY admin_write ON public.benchmarks
  FOR ALL TO authenticated
  USING ((SELECT es_admin()))
  WITH CHECK ((SELECT es_admin()));

-- ── sops y onboarding_*: la agencia completa ──────────────────────────────

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sops', 'onboarding_runs', 'onboarding_tasks', 'onboarding_templates'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE '077: la tabla % no existe, se omite', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS agency_full_access ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY agency_full_access ON public.%I FOR ALL TO authenticated USING ((SELECT get_user_type()) = %L) WITH CHECK ((SELECT get_user_type()) = %L)',
      t, 'agency', 'agency'
    );
  END LOOP;
END $$;

-- Verificación: las nueve deben salir con relrowsecurity = true y anon sin
-- privilegios.
SELECT c.relname,
       c.relrowsecurity,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_lee,
       has_table_privilege('anon', c.oid, 'INSERT') AS anon_escribe,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS politicas
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('users', 'webhook_logs', 'integrations', 'benchmarks', 'sops', 'sync_logs',
                    'onboarding_runs', 'onboarding_tasks', 'onboarding_templates')
ORDER BY c.relname;
