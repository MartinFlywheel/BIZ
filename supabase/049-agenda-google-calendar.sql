-- =====================================================
-- 048 — Lo que necesita la agenda para llenarse sola desde Google Calendar
-- =====================================================
-- El CRM ya tiene un webhook de Calendly completo (/api/webhooks/calendly),
-- pero registrar una suscripción de webhook exige plan pago de Calendly y la
-- cuenta que se usa es free. La salida es leer el Google Calendar donde
-- Calendly escribe los eventos: esa API sí es gratuita.
--
-- El evento que crea Calendly trae en su descripción todo lo que contestó la
-- persona al reservar —nombre, correo, zona horaria y cada pregunta del
-- formulario—, así que de ahí sale el Instagram sin depender de la API de
-- Calendly.
--
-- COLUMNAS
--
-- google_event_id  Clave de idempotencia. El sync corre cada pocos minutos y
--                  vuelve a ver los mismos eventos; sin esto crearía una
--                  agenda nueva en cada vuelta. Único por cliente, no global:
--                  dos clientes podrían leer calendarios distintos y no hay
--                  garantía de que Google no repita un id entre calendarios.
--
-- calendly_uuid    El identificador que aparece en los enlaces de cancelar y
--                  reprogramar de la descripción. Sobrevive a que Google
--                  recree el evento, así que sirve para reconocer una reserva
--                  que ya se había registrado.
--
-- hora_agenda      Hoy sólo existe fecha_agenda (DATE): se sabe el día pero no
--                  la hora. El triaje necesita la hora para calcular su plazo
--                  ("2 horas antes de la llamada"), y la agenda del día del
--                  director no se puede ordenar sin ella.
--
-- respuestas_formulario  Las respuestas crudas del formulario, tal como venían
--                  en la descripción. Se guarda el bloque entero y no sólo los
--                  campos que hoy se leen, porque el día que Mane agregue una
--                  pregunta el dato ya va a estar guardado en vez de perderse.
--
-- match_metodo     Cómo se resolvió el lead: instagram, email, telefono,
--                  nombre o manual. Sin esto no hay forma de saber si la
--                  cascada de matcheo está funcionando o si alguien lo asoció
--                  a mano cada vez.

ALTER TABLE agenda_records ADD COLUMN IF NOT EXISTS google_event_id TEXT;
ALTER TABLE agenda_records ADD COLUMN IF NOT EXISTS calendly_uuid TEXT;
ALTER TABLE agenda_records ADD COLUMN IF NOT EXISTS hora_agenda TIMESTAMPTZ;
ALTER TABLE agenda_records ADD COLUMN IF NOT EXISTS respuestas_formulario JSONB;
ALTER TABLE agenda_records ADD COLUMN IF NOT EXISTS match_metodo TEXT;

COMMENT ON COLUMN agenda_records.google_event_id IS
  'Id del evento en Google Calendar. Clave de idempotencia del sync: sin esto cada vuelta crearía una agenda duplicada.';
COMMENT ON COLUMN agenda_records.hora_agenda IS
  'Fecha y hora exactas de la llamada. fecha_agenda sólo guarda el día; el plazo del triaje se calcula contra esta.';
COMMENT ON COLUMN agenda_records.match_metodo IS
  'Cómo se resolvió el lead: instagram | email | telefono | nombre | manual. NULL mientras no haya lead asociado.';

-- Único por cliente y sólo sobre las filas que tienen id: las agendas cargadas
-- a mano no vienen de Google y quedarían todas colisionando en NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agenda_google_event
  ON agenda_records(client_id, google_event_id)
  WHERE google_event_id IS NOT NULL;

-- El sync busca por uuid de Calendly antes de crear, para reconocer una
-- reserva que Google haya recreado con otro id de evento.
CREATE INDEX IF NOT EXISTS idx_agenda_calendly_uuid
  ON agenda_records(client_id, calendly_uuid)
  WHERE calendly_uuid IS NOT NULL;

-- La agenda del día y el barrido de triaje piden por rango de hora.
CREATE INDEX IF NOT EXISTS idx_agenda_hora
  ON agenda_records(client_id, hora_agenda)
  WHERE hora_agenda IS NOT NULL;

-- El calendario a leer se configura por cliente, igual que el token de
-- Calendly: cada negocio tiene el suyo. Sin esto habría que hardcodear un
-- único calendario y el módulo no serviría para el segundo cliente.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS google_calendar_id TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS google_calendar_sync_token TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS google_calendar_synced_at TIMESTAMPTZ;

COMMENT ON COLUMN clients.google_calendar_id IS
  'Calendario de Google que Calendly llena para este cliente. Normalmente el correo de la cuenta. NULL = módulo apagado para este cliente.';
COMMENT ON COLUMN clients.google_calendar_sync_token IS
  'syncToken de la API de Calendar para pedir sólo lo que cambió desde la última vuelta, en vez de releer el calendario entero cada vez.';
COMMENT ON COLUMN agenda_records.match_metodo IS
  'Como se asocio el lead: instagram, email o nombre. Las de "nombre" son las dudosas y valen la pena revisar.';

-- ── Ultimo paso, a correr aparte ────────────────────────────────────────────
-- Esta migracion solo crea columnas. El cron que efectivamente lee el
-- calendario se agenda con pg_cron (ver 037-pg-cron-scheduler.sql), y va
-- SUELTO a proposito: agendar aqui significaria que el job empieza a correr
-- antes de que existan GOOGLE_SA_EMAIL y GOOGLE_SA_PRIVATE_KEY en Vercel, y
-- cada vuelta seria una respuesta inutil en net._http_response.
--
-- Correr recien cuando (1) las variables esten en Vercel, (2) haya un deploy
-- posterior a haberlas guardado, y (3) clients.google_calendar_id tenga valor:
--
--   SELECT cron.schedule(
--     'sync-agendas',
--     '*/10 * * * *',
--     $cmd$ SELECT private.call_cron_endpoint('/api/cron/sync-agendas') $cmd$
--   );
--
-- Cada 10 minutos y no cada minuto porque la agenda la reserva una persona:
-- diez minutos de atraso no le cambian la vida a nadie, y asi el job gasta
-- ~4.300 llamadas al mes en vez de 43.000.
--
-- Para comprobar que quedo andando:
--   SELECT jobid, status, return_message, start_time
--   FROM cron.job_run_details WHERE jobid = (
--     SELECT jobid FROM cron.job WHERE jobname = 'sync-agendas'
--   ) ORDER BY start_time DESC LIMIT 5;
--
-- Y que efectivamente trajo algo:
--   SELECT summary, created_at FROM cron_runs
--   WHERE job_name = 'sync-agendas' ORDER BY created_at DESC LIMIT 5;
