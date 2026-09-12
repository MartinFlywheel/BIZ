-- 069 · Respuestas del quiz de precalificación en el lead
--
-- La landing de Aurora Ancestral (soyauroraancestral.vercel.app) hace cuatro
-- preguntas antes de mandar a la persona a WhatsApp: qué zonas le afectan, a
-- qué se dedica, qué probó antes y cuánto puede invertir. Hasta ahora esas
-- respuestas vivían solo en el navegador y se perdían al cerrar la pestaña,
-- así que el setter contestaba sin saber nada de quien le escribía.
--
-- Se guarda como JSONB en el propio lead y no en una tabla aparte porque:
--   · es una sola fila por persona, no un historial;
--   · el conjunto de preguntas va a cambiar mientras se afina el embudo, y
--     una tabla con columnas fijas obligaría a una migración cada vez;
--   · se lee siempre junto al lead, nunca por su cuenta.
--
-- Se descartó reutilizar `referral` (migración 065): ese campo es el anuncio
-- de origen y lo leen las métricas de Meta Ads. Mezclar las dos cosas rompería
-- la atribución.
--
-- El resumen legible va además al campo `notes`, que ya se muestra en la
-- tabla del CRM. Esta columna es para poder consultarlo: filtrar por cuánto
-- puede invertir, contar zonas, alimentar el semáforo.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS quiz JSONB;

COMMENT ON COLUMN leads.quiz IS
  'Respuestas del quiz de precalificación de la landing. Lo escribe POST /api/agent/v1/leads/quiz.';

-- Índice GIN: permite preguntar por una clave del JSON sin recorrer la tabla
-- entera, por ejemplo quiénes marcaron un tramo de inversión.
CREATE INDEX IF NOT EXISTS idx_leads_quiz ON leads USING GIN (quiz);
