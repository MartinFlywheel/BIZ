-- =====================================================
-- 047 — Los contadores de las pestañas en una sola consulta
-- =====================================================
-- La página de detalle de cliente disparaba SEIS consultas en paralelo antes
-- de pintar nada: el cliente, la lista para el selector y cuatro contadores
-- (contenido, leads, llamadas, competencia), uno por tabla. Los cuatro
-- contadores existen sólo para el numerito al lado del nombre de cada pestaña.
--
-- Dos problemas con eso:
--
-- 1. Cuatro conexiones y cuatro viajes de ida y vuelta para cuatro números.
--    En el plan free de Supabase el pool es chico y esta página no está sola:
--    encima de ella corren las consultas de la pestaña abierta, el panel de
--    tareas y el tablero de contenido. Bajo esa presión aparecen errores de
--    transporte sin código ni mensaje —`{ message: '' }` en los logs— que no
--    son de ninguna consulta en particular sino de quedarse sin conexión.
--
-- 2. Iban todos en un Promise.all, así que cualquiera que fallara reventaba
--    la página entera con "This page couldn't load". Cuatro adornos podían
--    tumbar una pantalla que por lo demás funcionaba.
--
-- Esta función devuelve los cuatro números en una sola sentencia. El código
-- además la trata como opcional: si falla, muestra las pestañas sin badge en
-- vez de romper.
--
-- SECURITY INVOKER a propósito: corre con los permisos de quien llama, así que
-- las políticas RLS de cada tabla se siguen aplicando igual que en las
-- consultas sueltas que reemplaza.

CREATE OR REPLACE FUNCTION public.client_tab_counts(p_client_id UUID)
RETURNS TABLE (content_pieces BIGINT, leads BIGINT, calls BIGINT, competitors BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    (SELECT count(*) FROM content_pieces cp WHERE cp.client_id = p_client_id),
    (SELECT count(*) FROM leads l           WHERE l.client_id  = p_client_id),
    -- sales_calls no tiene client_id: cuelga del lead, igual que la consulta
    -- que reemplaza (leads!inner(client_id)).
    (SELECT count(*) FROM sales_calls sc
       JOIN leads l2 ON l2.id = sc.lead_id
      WHERE l2.client_id = p_client_id),
    (SELECT count(*) FROM competitors c     WHERE c.client_id  = p_client_id);
$$;

GRANT EXECUTE ON FUNCTION public.client_tab_counts(UUID) TO authenticated;

COMMENT ON FUNCTION public.client_tab_counts IS
  'Los cuatro contadores de las pestañas del detalle de cliente en una sola consulta, en vez de cuatro conexiones separadas. Ver src/app/(agency)/clients/[id]/page.tsx.';
