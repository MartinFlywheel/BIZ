-- =====================================================
-- 039 — La dirección de ventas es una responsabilidad, no un rol
-- =====================================================
-- `users.role` es una sola columna con CHECK: cada persona tiene UN rol.
-- Martín (dirección de marketing) y Fabián Juárez (dirección de ventas) son
-- ambos `admin`, así que "asignarle esta tarea al director de ventas" no puede
-- resolverse consultando el rol — los dos darían el mismo resultado. Y el rol
-- `sales_director` quedó prácticamente muerto: una sola referencia en todo el
-- código, contra once de `admin`.
--
-- La separación correcta ya existe en el esquema, solo faltaba usarla:
--
--   users.role        → qué PUEDE VER (permiso). Ambos admin, ambos ven todo,
--                       incluida la vista de dirección de ventas.
--   team_assignments  → de qué es RESPONSABLE (función), y por cliente.
--
-- Falta el valor 'sales_direction'. Reutilizar 'closing' mezclaría dos cosas
-- que en el flujo de triaje son personas distintas: la dirección de ventas
-- hace el triaje, el closer toma la llamada. Hoy Fabián hace ambas, pero el
-- día que entre un closer dedicado las tareas de triaje lo seguirían a él por
-- error.
--
-- Efecto práctico: los admins VEN todas las colas; el popup y el push suenan
-- solo para el responsable. Sin esto, Martín recibiría los avisos de triaje de
-- Fabián todos los días y terminaría silenciándolos.

-- 1) Extender el CHECK de responsabilidades ---------------------------------
ALTER TABLE team_assignments
  DROP CONSTRAINT IF EXISTS team_assignments_responsibility_check;

ALTER TABLE team_assignments
  ADD CONSTRAINT team_assignments_responsibility_check
  CHECK (responsibility IN ('content', 'setting', 'closing', 'strategy', 'sales_direction'));

-- 2) Asignar a Fabián como dirección de ventas ------------------------------
-- Busca por correo y no por nombre, para no depender de cómo estén escritas
-- las tildes ("Fabián"/"Fabian", "Juárez"/"Juarez").
--
-- REEMPLAZAR el correo antes de correr. Si no existe, esto falla con un
-- mensaje claro en vez de no insertar nada en silencio.
DO $$
DECLARE
  director_id UUID;
  asignados   INT;
BEGIN
  SELECT id INTO director_id
  FROM users
  WHERE email = 'REEMPLAZAR_CORREO_DE_FABIAN'
    AND user_type = 'agency';

  IF director_id IS NULL THEN
    RAISE EXCEPTION
      'No hay ningún usuario de agencia con ese correo. Revisa el valor y vuelve a correr este bloque.';
  END IF;

  INSERT INTO team_assignments (client_id, user_id, responsibility, is_primary)
  SELECT c.id, director_id, 'sales_direction', true
  FROM clients c
  WHERE c.status = 'active'
  ON CONFLICT (client_id, user_id, responsibility) DO NOTHING;

  GET DIAGNOSTICS asignados = ROW_COUNT;
  RAISE NOTICE 'Dirección de ventas asignada en % cliente(s) activo(s).', asignados;
END $$;

-- 3) Verificación (correr aparte) -------------------------------------------
-- Debe listar un responsable por cada cliente activo:
--
--   SELECT c.name AS cliente, u.full_name AS responsable, u.role, ta.is_primary
--   FROM team_assignments ta
--   JOIN clients c ON c.id = ta.client_id
--   JOIN users   u ON u.id = ta.user_id
--   WHERE ta.responsibility = 'sales_direction'
--   ORDER BY c.name;
--
-- Clientes activos que quedaron SIN dirección de ventas (debe dar 0 filas):
--
--   SELECT c.name
--   FROM clients c
--   WHERE c.status = 'active'
--     AND NOT EXISTS (
--       SELECT 1 FROM team_assignments ta
--       WHERE ta.client_id = c.id AND ta.responsibility = 'sales_direction'
--     );
