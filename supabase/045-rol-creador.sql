-- =====================================================
-- 045 — Rol "creador"
-- =====================================================
-- El creador de la marca personal del cliente: quien produce el contenido de
-- la cuenta. Necesita ver el panel completo de SU negocio —Analítica,
-- Contenido, Script, Llamadas, Competencia, Producto— pero nada de la agencia:
-- ni el dashboard general, ni la lista de clientes, ni Reportes, ni SOPs, ni
-- Configuración.
--
-- No hace falta lógica nueva para eso: el CRM ya trata a TODO usuario de
-- agencia que no sea admin como "restringido", y esa restricción es justo la
-- que se busca acá:
--
--   * src/lib/supabase/middleware.ts lo confina por URL a /clients/{su
--     client_id} — cualquier otra ruta lo redirige de vuelta ahí, así que no
--     alcanza otros clientes ni escribiendo la dirección a mano.
--   * src/app/(agency)/layout.tsx calcula `restricted = role !== 'admin'` y
--     con eso la barra lateral se renderiza sin ningún enlace.
--   * crm-tab.tsx sólo muestra la sub-pestaña Equipo si isAdmin, así que el
--     creador no ve los correos ni los roles del resto del equipo.
--
-- La única diferencia con un `setter` es que el setter ve exclusivamente la
-- pestaña CRM (client-detail.tsx corta las pestañas cuando isSetter), mientras
-- que el creador ve el panel entero. Como `creador` no es `setter`, eso sale
-- solo sin tocar esa lógica.
--
-- Un creador tiene que tener client_id asignado, si no el layout le muestra
-- "Tu cuenta no tiene un cliente asignado" en vez del panel.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN (
    'admin', 'sales_director', 'closer', 'setter', 'editor', 'client_owner', 'creador'
  ));

COMMENT ON COLUMN users.role IS
  'Rol dentro de la agencia. Sólo `admin` no está restringido: el resto queda confinado por middleware a /clients/{client_id} y sin barra lateral. `creador` es quien produce el contenido de la marca personal del cliente y ve el panel completo de ese negocio.';
