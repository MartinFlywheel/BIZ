-- =====================================================
-- 046 — Rellenar el perfil y los CTAs en las agendas ya creadas
-- =====================================================
-- ensureAgendaRecordForLead (src/lib/actions/leads.ts) llenaba primer_cta y
-- de_donde_vino al crear la agenda, pero dejaba siempre vacíos link_perfil y
-- todos_los_ctas — aunque el dato ya existía en la base:
--
--   link_perfil     → leads.ig_username
--   todos_los_ctas  → las interacciones del lead, cada una apuntando a la
--                     pieza cuyo keyword_trigger es el CTA visible ("H_18_08")
--
-- Había que escribirlos a mano en el cajón de cada agenda, así que en la
-- práctica quedaban en blanco. El código ya los llena para las agendas nuevas;
-- esto arregla las que quedaron atrás.
--
-- Sólo toca filas vacías: si alguien escribió algo a mano ahí, se respeta.
-- Y sólo alcanza a las agendas con lead_id (las creadas desde el CRM al mover
-- un lead a "Agendado"); las cargadas a mano sin lead asociado no tienen de
-- dónde sacar el dato.

-- 1) Link al perfil de Instagram
UPDATE agenda_records a
SET link_perfil = 'https://instagram.com/' || ltrim(l.ig_username, '@')
FROM leads l
WHERE a.lead_id = l.id
  AND l.ig_username IS NOT NULL
  AND l.ig_username <> ''
  AND (a.link_perfil IS NULL OR a.link_perfil = '');

-- 2) Todos los CTAs que tocó el lead
-- Las interacciones se enlazan por ig_username dentro del mismo cliente, en
-- minúsculas porque el usuario llega con distinta capitalización según por
-- dónde entró.
UPDATE agenda_records a
SET todos_los_ctas = sub.ctas
FROM (
  SELECT ar.id,
         string_agg(DISTINCT cp.keyword_trigger, ' · ' ORDER BY cp.keyword_trigger) AS ctas
  FROM agenda_records ar
  JOIN leads l           ON l.id = ar.lead_id
  JOIN interactions i    ON i.client_id = l.client_id
                        AND lower(i.ig_username) = lower(l.ig_username)
  JOIN content_pieces cp ON cp.id = i.content_id
  WHERE cp.keyword_trigger IS NOT NULL
    AND cp.keyword_trigger <> ''
    AND l.ig_username IS NOT NULL
  GROUP BY ar.id
) sub
WHERE a.id = sub.id
  AND (a.todos_los_ctas IS NULL OR a.todos_los_ctas = '');
