-- =====================================================
-- 078 — El CTA de las agendas deja de ser el nombre del evento de Calendly
-- =====================================================
--
-- EL PROBLEMA
-- El panel "Lo que recibe marketing" agrupa las agendas por
-- agenda_records.de_donde_vino (la columna CTA). El sync de Google Calendar
-- y el webhook de Calendly guardaban ahí el nombre del evento de Calendly,
-- "30 Minute Meeting", que no dice nada del origen. Resultado: 15 agendas de
-- Mane aparecían como si vinieran de una campaña llamada "30 Minute Meeting"
-- y no sumaban a la pieza real (C_01_09, R_07_09, H_13_08...).
--
-- El código ya se corrigió: ahora se escribe el código de la pieza del lead
-- (src/lib/services/origen-lead.ts). Esta migración arregla las filas que ya
-- estaban guardadas.
--
-- QUÉ SE DECIDIÓ
-- Mismo orden que el código: la pieza del lead (content_id), la del primer
-- contacto (first_touch_content_id) y el "manychat:{código}" de
-- first_touch_type. Si el lead no tiene ninguna, el CTA queda NULL ("Sin
-- origen"), que es la verdad: mejor eso que un nombre de evento.
--
-- Se descartó borrar el dato sin reemplazo: 8 de las 15 tienen pieza.
-- Solo se tocan filas cuyo CTA es exactamente el nombre del evento, así que
-- lo escrito a mano no se pisa.
--
-- Idempotente: una segunda corrida no encuentra filas con ese valor.

UPDATE agenda_records a
SET de_donde_vino = COALESCE(
      (SELECT cp.keyword_trigger FROM leads l JOIN content_pieces cp ON cp.id = l.content_id WHERE l.id = a.lead_id),
      (SELECT cp.keyword_trigger FROM leads l JOIN content_pieces cp ON cp.id = l.first_touch_content_id WHERE l.id = a.lead_id),
      (SELECT substring(l.first_touch_type FROM '^manychat:(.+)$') FROM leads l WHERE l.id = a.lead_id)
    ),
    updated_at = now()
WHERE a.de_donde_vino = '30 Minute Meeting';

-- Verificación: debe salir 0.
SELECT count(*) AS quedan_con_nombre_de_evento
FROM agenda_records
WHERE de_donde_vino = '30 Minute Meeting';
