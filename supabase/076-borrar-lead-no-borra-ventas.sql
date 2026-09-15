-- =====================================================
-- 076 — Borrar un lead ya no borra sus ventas, y la cuenta de ManyChat de cada
--       cliente
-- =====================================================
--
-- EL PROBLEMA 1: EL BORRADO DE UN LEAD ARRASTRABA DATOS DE VENTA
-- Las FK hacia leads de agenda_records, sales_calls, program_students e
-- incoming_messages eran ON DELETE CASCADE. Borrar un lead (a mano desde el
-- CRM, o con el cron prune-stale-leads) se llevaba sus agendas, sus llamadas,
-- su ficha de alumna y sus mensajes. Ejemplo real: xime.mefi, en
-- nuevo_contacto con una sola interacción, tiene una agenda "No Cerrado" que
-- habría desaparecido con el borrado automático.
--
-- El cron ya protege a los leads con agenda, llamada o alumna (commit 4b662a7),
-- pero esa es una regla del código: cualquier otra vía que borre leads (el
-- botón de eliminar, un script, una API) seguía arrastrando las ventas. Esta
-- migración pone el respaldo en la base.
--
-- QUÉ SE DECIDIÓ
-- ON DELETE SET NULL en esas cuatro FK: la agenda, la llamada, la alumna y el
-- mensaje sobreviven sin lead asociado, y el pipeline de agendas ya sabe
-- mostrar "sin lead" y pedir la asociación.
-- sales_calls.lead_id era NOT NULL; se le quita el NOT NULL porque si no el
-- SET NULL fallaría y el borrado del lead quedaría bloqueado.
--
-- Se descartó:
--   - ON DELETE RESTRICT: bloquearía el cron y el botón de eliminar con un
--     error que el equipo no sabe resolver.
--   - Tocar lead_activity_logs: es el historial del propio lead y sin lead no
--     significa nada. Sigue en CASCADE (y la línea de tiempo de la 075 guarda
--     el evento de borrado aparte).
--
-- EL PROBLEMA 2: CHATS DE MANYCHAT SIN PIEZA SE DESCARTABAN
-- El webhook de ManyChat reconoce el cliente solo por el código de la pieza
-- (keyword_trigger). Si el código no existe (H_06_08 y R_17_08 nunca se
-- crearon como piezas), la llamada se descartaba entera: 681 llamadas y unas
-- 500 personas de Mane entre agosto y septiembre. Pero cada llamada trae
-- live_chat_url = https://app.manychat.com/fb2902903/..., y ese
-- "fb2902903" es la cuenta de ManyChat, que identifica al cliente sin
-- necesidad de pieza.
--
-- QUÉ SE AGREGA
-- clients.manychat_account_id  La cuenta de ManyChat del cliente (el segmento
--                              de live_chat_url). Índice único parcial: dos
--                              clientes con la misma cuenta mandarían los
--                              chats al cliente equivocado.
-- Se llena para Mane (fb2902903) solo si está vacío, para no pisar un valor
-- que alguien corrigió a mano.
--
-- El código degrada si esta migración no se corrió: sin la columna (42703)
-- deduce el cliente del último webhook procesado de la misma cuenta.
--
-- Idempotente: los DROP CONSTRAINT/ADD CONSTRAINT van dentro de un DO que
-- revisa la regla actual en pg_constraint, así que una segunda corrida no
-- cambia nada.

SELECT set_config('lock_timeout', '10s', true);

-- ── 1. FK hacia leads: SET NULL en vez de CASCADE ─────────────────────────

ALTER TABLE sales_calls ALTER COLUMN lead_id DROP NOT NULL;

DO $$
DECLARE
  t text;
  r record;
BEGIN
  FOREACH t IN ARRAY ARRAY['agenda_records', 'sales_calls', 'program_students', 'incoming_messages'] LOOP
    -- Si la tabla no existe en este entorno, se salta.
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE '076: la tabla % no existe, se omite', t;
      CONTINUE;
    END IF;

    -- Toda FK de esa tabla que apunte a leads por lead_id y no sea SET NULL.
    -- Se busca por columnas y no por nombre, por si en algún entorno la
    -- restricción tiene otro nombre.
    FOR r IN
      SELECT c.conname, c.confdeltype
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid
       AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f'
        AND c.conrelid = ('public.' || t)::regclass
        AND c.confrelid = 'public.leads'::regclass
        AND a.attname = 'lead_id'
        AND array_length(c.conkey, 1) = 1
    LOOP
      IF r.confdeltype = 'n' THEN
        CONTINUE; -- ya es SET NULL
      END IF;
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, r.conname);
      RAISE NOTICE '076: % pierde % (regla %)', t, r.conname, r.confdeltype;
    END LOOP;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid
       AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f'
        AND c.conrelid = ('public.' || t)::regclass
        AND c.confrelid = 'public.leads'::regclass
        AND a.attname = 'lead_id'
        AND c.confdeltype = 'n'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL',
        t, t || '_lead_id_fkey'
      );
      RAISE NOTICE '076: % ahora es ON DELETE SET NULL', t;
    END IF;
  END LOOP;
END $$;

-- ── 2. Cuenta de ManyChat por cliente ─────────────────────────────────────

ALTER TABLE clients ADD COLUMN IF NOT EXISTS manychat_account_id TEXT;

COMMENT ON COLUMN clients.manychat_account_id IS
  'Cuenta de ManyChat del cliente: el segmento de live_chat_url (https://app.manychat.com/<cuenta>/...). Permite registrar chats cuyo código no tiene pieza. Ver supabase/076.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_manychat_account_id
  ON clients (manychat_account_id)
  WHERE manychat_account_id IS NOT NULL;

-- Mane (Aurora Ancestral). fb2902903 aparece en el 100% de sus webhooks
-- procesados. Solo si está vacío y ningún otro cliente la tiene ya.
UPDATE clients
SET manychat_account_id = 'fb2902903'
WHERE id = 'ad9b2e47-aac9-4585-9aee-95f956fa4261'
  AND manychat_account_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM clients WHERE manychat_account_id = 'fb2902903');

-- Verificación: las cuatro FK deben salir con confdeltype = 'n'.
SELECT conrelid::regclass AS tabla, conname, confdeltype
FROM pg_constraint
WHERE contype = 'f'
  AND confrelid = 'public.leads'::regclass
ORDER BY 1;
