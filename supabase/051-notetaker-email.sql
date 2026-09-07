-- A que correo invitar para que la notetaker entre sola a la llamada
--
-- El problema que esto cierra: hoy el director de ventas tiene que mandar la
-- Fathom a mano a cada llamada de la clienta. Como la cuenta de servicio ya
-- tiene permiso de escritura sobre el calendario, el CRM puede agregar a la
-- notetaker como invitada del evento apenas la reserva aparece, y Fathom entra
-- sola porque ve la reunion en su propio calendario.
--
-- Va por cliente y no como variable de entorno porque cada negocio puede usar
-- su propia cuenta de Fathom, igual que cada uno tiene su calendario.
--
-- NULL = apagado para ese cliente. Es el valor por defecto a proposito: invitar
-- a un correo equivocado le manda una invitacion a un desconocido a la reunion
-- de un prospecto, asi que esto se enciende solo cuando hay un correo
-- confirmado.
--
-- Idempotente: correrlo dos veces no cambia nada.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS notetaker_email TEXT;

COMMENT ON COLUMN clients.notetaker_email IS
  'Correo de la notetaker (Fathom) que el CRM agrega como invitada a cada agenda. NULL = no invitar a nadie.';

-- Deja constancia de a quien se invito y cuando, para poder revisar despues
-- por que una llamada no quedo grabada.
ALTER TABLE agenda_records ADD COLUMN IF NOT EXISTS notetaker_invitada_at TIMESTAMPTZ;

COMMENT ON COLUMN agenda_records.notetaker_invitada_at IS
  'Cuando el CRM agrego a la notetaker como invitada del evento. NULL = no se invito (o el cliente no lo tiene configurado).';

-- ── Para encenderlo ─────────────────────────────────────────────────────────
-- Con el correo que da Fathom para invitar al bot:
--
--   UPDATE clients
--   SET notetaker_email = 'el-correo-de-fathom@fathom.video'
--   WHERE id = 'ad9b2e47-aac9-4585-9aee-95f956fa4261'
--   RETURNING id, name, notetaker_email;
--
-- No pongas aqui el correo del dueno del calendario: ya es el organizador del
-- evento, invitarlo de nuevo no hace nada.
