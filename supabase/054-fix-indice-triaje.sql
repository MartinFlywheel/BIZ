-- Arreglar el indice unico del triaje para que el upsert funcione
--
-- EL ERROR
-- El barrido devolvia:
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
-- y por lo tanto no creaba ninguna tarea de triaje.
--
-- LA CAUSA
-- La 053 creo el indice como parcial:
--
--   CREATE UNIQUE INDEX idx_system_tasks_agenda
--     ON system_tasks(agenda_record_id, tipo)
--     WHERE agenda_record_id IS NOT NULL;
--
-- Postgres solo usa un indice parcial para resolver un ON CONFLICT si la
-- sentencia repite el mismo predicado (ON CONFLICT (...) WHERE ...), y la API
-- de Supabase no tiene como expresar esa parte: solo manda la lista de
-- columnas. Con lo cual nunca encontraba el indice.
--
-- El WHERE ademas sobraba. En un indice unico los NULL se consideran distintos
-- entre si, asi que sin predicado siguen pudiendo existir varias filas con
-- agenda_record_id NULL, que es lo que el parcial intentaba permitir.
--
-- Idempotente: se puede correr dos veces.

DROP INDEX IF EXISTS idx_system_tasks_agenda;

CREATE UNIQUE INDEX IF NOT EXISTS idx_system_tasks_agenda
  ON system_tasks(agenda_record_id, tipo);

-- Comprobacion: esta consulta no debe devolver nada. Si devuelve una fila, el
-- indice quedo parcial de nuevo y el upsert va a seguir fallando.
--
--   SELECT indexname, indexdef FROM pg_indexes
--   WHERE indexname = 'idx_system_tasks_agenda' AND indexdef LIKE '%WHERE%';
