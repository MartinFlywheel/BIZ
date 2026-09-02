-- =====================================================
-- 038 — Borrado de clientes en cascada
-- =====================================================
-- Eliminar un cliente fallaba en silencio: casi todas las FKs que apuntan a
-- clients(id) se crearon con el ON DELETE NO ACTION por defecto (leads,
-- content_pieces, interactions, client_metrics, competitors, team_assignments,
-- campaigns, agenda_records, onboarding_runs...). Con cualquier dato asociado,
-- el DELETE se rechazaba con error 23503 y el cliente seguía en la lista.
--
-- Esta migración recorre el grafo de FKs hacia abajo desde clients y reescribe
-- cada una con ON DELETE CASCADE, incluyendo los niveles indirectos
-- (content_notes -> content_pieces, sales_calls -> leads, etc.).
--
-- Excepción: users.client_id pasa a ON DELETE SET NULL. Borrar un cliente no
-- debe borrar la cuenta de una persona; solo la desvincula.
--
-- Es idempotente: correrla de nuevo no toca las FKs que ya quedaron bien.

DO $$
DECLARE
  targets   TEXT[] := ARRAY['clients'];
  found     TEXT[];
  fk        RECORD;
  def       TEXT;
  act       TEXT;
  want      CHAR;
BEGIN
  LOOP
    found := ARRAY[]::TEXT[];

    FOR fk IN
      SELECT c.oid, c.conname, src.relname AS src_table, c.confdeltype
      FROM pg_constraint c
      JOIN pg_class src ON src.oid = c.conrelid
      JOIN pg_class tgt ON tgt.oid = c.confrelid
      JOIN pg_namespace ns ON ns.oid = src.relnamespace
      JOIN pg_namespace nt ON nt.oid = tgt.relnamespace
      WHERE c.contype = 'f'
        AND ns.nspname = 'public'
        AND nt.nspname = 'public'
        AND tgt.relname = ANY(targets)
        AND src.relname <> tgt.relname  -- autorreferencias (call_folders.parent_id) ya cascadean
    LOOP
      IF fk.src_table = 'users' THEN
        act  := 'SET NULL';
        want := 'n';
      ELSE
        act  := 'CASCADE';
        want := 'c';
      END IF;

      IF fk.confdeltype <> want THEN
        def := pg_get_constraintdef(fk.oid);
        def := regexp_replace(
          def,
          '\s+ON DELETE (NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)',
          '',
          'i'
        );

        -- DEFERRABLE/INITIALLY va siempre al final de la definición
        IF def ~* 'DEFERRABLE' THEN
          def := regexp_replace(def, '(\s+(NOT\s+)?DEFERRABLE)', ' ON DELETE ' || act || '\1', 'i');
        ELSE
          def := def || ' ON DELETE ' || act;
        END IF;

        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', fk.src_table, fk.conname);
        EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s', fk.src_table, fk.conname, def);
        RAISE NOTICE '% . % -> ON DELETE %', fk.src_table, fk.conname, act;
      END IF;

      IF act = 'CASCADE'
         AND NOT (fk.src_table = ANY(targets))
         AND NOT (fk.src_table = ANY(found)) THEN
        found := array_append(found, fk.src_table);
      END IF;
    END LOOP;

    EXIT WHEN cardinality(found) = 0;
    targets := targets || found;
  END LOOP;
END $$;
