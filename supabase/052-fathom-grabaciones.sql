-- Enganchar las grabaciones de Fathom a la agenda que les corresponde
--
-- El problema original de todo esto: la grabacion de cada llamada vive en
-- Fathom y alguien tiene que ir a buscarla y pasarla a mano. El reporte de
-- llamadas que alimenta a marketing depende de eso, asi que nunca esta al dia.
--
-- Fathom tiene API (api.fathom.ai/external/v1/meetings) y devuelve, por
-- reunion, el enlace para compartir, el resumen y los invitados del calendario.
-- Con eso el CRM puede pegar cada grabacion a su agenda solo.
--
-- COMO SE CRUZAN
-- La agenda y la reunion de Fathom salen del mismo evento de Google Calendar,
-- asi que la hora de inicio coincide exacto: ese es el cruce principal
-- (agenda_records.hora_agenda contra scheduled_start_time de Fathom). El correo
-- del invitado se usa para confirmar, y por eso se empieza a guardar: hasta
-- ahora se leia para buscar el lead y se descartaba, y sin el el cruce por hora
-- sola se equivoca si hay dos llamadas a la misma hora en calendarios
-- distintos.
--
-- Idempotente: correrlo dos veces no cambia nada.

-- El correo con el que la persona reservo. Sirve para confirmar el cruce con
-- Fathom y, de paso, para que el setter lo tenga a la vista en el triaje.
ALTER TABLE agenda_records ADD COLUMN IF NOT EXISTS email_lead TEXT;

-- Identificador de la grabacion en Fathom. Es lo que evita traer dos veces la
-- misma reunion.
ALTER TABLE agenda_records ADD COLUMN IF NOT EXISTS fathom_recording_id TEXT;

-- El resumen que genera Fathom, en markdown. Se guarda entero en vez de solo el
-- enlace para que el reporte de llamadas se pueda armar sin salir del CRM.
ALTER TABLE agenda_records ADD COLUMN IF NOT EXISTS fathom_resumen TEXT;

ALTER TABLE agenda_records ADD COLUMN IF NOT EXISTS fathom_sincronizado_at TIMESTAMPTZ;

COMMENT ON COLUMN agenda_records.email_lead IS
  'Correo con el que la persona reservo en Calendly. Se usa para cruzar la grabacion de Fathom y para el triaje del setter.';
COMMENT ON COLUMN agenda_records.fathom_recording_id IS
  'recording_id de Fathom. NULL = todavia no se encontro grabacion para esta agenda.';
COMMENT ON COLUMN agenda_records.fathom_resumen IS
  'Resumen en markdown que genera Fathom (default_summary.markdown_formatted).';

-- El enlace para ver la grabacion va en link_reporte, que ya existe y es
-- exactamente eso. No se crea una columna nueva para lo mismo.

-- Evita traer dos veces la misma grabacion.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agenda_fathom_recording
  ON agenda_records(client_id, fathom_recording_id)
  WHERE fathom_recording_id IS NOT NULL;

-- El cruce busca agendas pasadas que todavia no tienen grabacion.
CREATE INDEX IF NOT EXISTS idx_agenda_sin_grabacion
  ON agenda_records(client_id, hora_agenda)
  WHERE fathom_recording_id IS NULL AND hora_agenda IS NOT NULL;

-- ── Que falta para encenderlo ───────────────────────────────────────────────
-- 1) FATHOM_API_KEY en las variables de entorno de Vercel, y un deploy nuevo.
-- 2) Agendar el cron (ver 037-pg-cron-scheduler.sql para el patron):
--
--   SELECT cron.schedule(
--     'sync-fathom',
--     '*/30 * * * *',
--     $cmd$ SELECT private.call_cron_endpoint('/api/cron/sync-fathom') $cmd$
--   );
--
-- Cada 30 minutos y no cada 10 como el de agendas: la grabacion recien existe
-- cuando la llamada termino, y Fathom se demora unos minutos en procesarla.
-- Buscarla mas seguido solo gasta llamadas a la API.
