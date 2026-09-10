-- Conectar el calendario de Google de Mane al modulo de agendas
--
-- La 049 creo la columna clients.google_calendar_id pero la dejo vacia a
-- proposito: el modulo se enciende cliente por cliente, y un calendario mal
-- puesto es peor que ninguno. Este archivo lo enciende para el primero.
--
-- El ID del calendario es el correo de la cuenta (soyauroraancestral@gmail.com)
-- porque es su calendario principal, no uno creado aparte. "Aurora Ancestral"
-- es la marca; en el CRM la clienta figura como "Mane".
--
-- Se filtra por id y no por nombre: un ILIKE sobre name ya fallo una vez (se
-- busco '%aurora%' y no existe ningun cliente con ese nombre), y un UPDATE que
-- no matchea nada falla en silencio con "Success. No rows returned".
--
-- Idempotente: correrlo dos veces deja el mismo valor.

-- 1) Confirma sobre quien vas a escribir antes de escribir.
SELECT id, name, google_calendar_id
FROM clients
WHERE id = 'ad9b2e47-aac9-4585-9aee-95f956fa4261';

-- 2) El cambio. RETURNING muestra la fila afectada: si devuelve vacio, el id
--    no existe y no se hizo nada.
UPDATE clients
SET google_calendar_id = 'soyauroraancestral@gmail.com'
WHERE id = 'ad9b2e47-aac9-4585-9aee-95f956fa4261'
RETURNING id, name, google_calendar_id;

-- ── Para apagarlo ───────────────────────────────────────────────────────────
-- Dejar google_calendar_id en NULL desconecta el calendario sin borrar nada de
-- lo ya sincronizado:
--
--   UPDATE clients SET google_calendar_id = NULL, google_calendar_sync_token = NULL
--   WHERE id = 'ad9b2e47-aac9-4585-9aee-95f956fa4261';
--
-- El sync_token tambien se limpia: un token viejo apuntando a un calendario que
-- se dejo de leer haria que al reconectar se perdieran los eventos de ese
-- intervalo, porque Google solo entrega los cambios posteriores al token.
