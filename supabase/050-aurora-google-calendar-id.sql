-- Conectar el calendario de Aurora Ancestral al modulo de agendas
--
-- La 049 creo la columna clients.google_calendar_id pero la dejo vacia a
-- proposito: el modulo se enciende cliente por cliente, y un calendario mal
-- puesto es peor que ninguno. Este archivo es el que efectivamente lo enciende
-- para el primer cliente.
--
-- El ID del calendario es el correo de la cuenta porque es su calendario
-- principal (el que lleva el nombre de la cuenta), no uno creado aparte. Se
-- confirmo en Google Calendar → Configuracion de mis calendarios →
-- Soyauroraancestral → Integrar calendario → ID del calendario.
--
-- Idempotente: correrlo dos veces deja el mismo valor.

-- 1) Primero mira a quien le vas a pegar el cambio. Si esto devuelve mas de
--    una fila, o ninguna, ajusta el filtro antes de seguir.
SELECT id, name, google_calendar_id
FROM clients
WHERE name ILIKE '%aurora%';

-- 2) El cambio. RETURNING muestra sobre que fila se aplico, para no quedarse
--    con la duda de si agarro al cliente correcto.
UPDATE clients
SET google_calendar_id = 'soyauroraancestral@gmail.com'
WHERE name ILIKE '%aurora%'
RETURNING id, name, google_calendar_id;

-- ── Para apagarlo ───────────────────────────────────────────────────────────
-- Dejar google_calendar_id en NULL desconecta el calendario sin borrar nada de
-- lo ya sincronizado:
--
--   UPDATE clients SET google_calendar_id = NULL, google_calendar_sync_token = NULL
--   WHERE name ILIKE '%aurora%';
--
-- El sync_token tambien se limpia: un token viejo apuntando a un calendario que
-- se dejo de leer haria que al reconectar se perdieran los eventos de ese
-- intervalo, porque Google solo entrega los cambios posteriores al token.
