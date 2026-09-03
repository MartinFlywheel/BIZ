-- =====================================================
-- 044 — Agregar las interacciones en Postgres, no en JavaScript
-- =====================================================
-- La pestaña Analítica de un cliente grande (Mane: 9.860 leads) moría con
-- 57014 — statement_timeout de Postgres, 8 s para el rol authenticated.
--
-- 57014 es un timeout POR SENTENCIA, no por la suma del pedido. O sea que
-- había una consulta suelta que se pasaba de 8 s, y era una de las páginas
-- profundas de getLiveMetricsBuckets: esa función se traía TODAS las
-- interacciones del rango con paginación por OFFSET (.range()), y en la página
-- 20 Postgres tiene que recorrer y descartar 19.000 filas antes de devolver
-- las 1.000 siguientes.
--
-- Encima Analítica lo pide dos veces por carga —período actual y anterior, 180
-- días en total con el rango por defecto de 90.
--
-- El bucle de JavaScript que consume esas filas sólo necesita CONTEOS: cuántas
-- interacciones hubo por día, de qué tipo de contenido venían y con qué
-- clasificación. Traerse las filas para contarlas en memoria era el error.
-- Esta función devuelve a lo sumo días × tipos × clasificaciones filas —unas
-- 2.000 para 180 días— en una sola sentencia que usa el índice
-- idx_interactions_client_date que ya existe.
--
-- SECURITY INVOKER a propósito: la función corre con los permisos de quien la
-- llama, así que las políticas RLS de interactions se siguen aplicando igual
-- que en la consulta directa. No abre ningún camino nuevo a los datos.
--
-- El LEFT JOIN contra content_pieces reproduce lo que hacía el código: el tipo
-- sale de la pieza vinculada, sin filtrar por su fecha de publicación (una
-- interacción de hoy puede venir de un reel de hace meses), y las
-- interacciones sin content_id quedan con tipo NULL, que es como se contaban.
--
-- La fecha se calcula en UTC porque el código comparaba `bot_triggered_at`
-- recortado a 10 caracteres del ISO que devuelve PostgREST, que es UTC. Salir
-- de esa zona cambiaría de bucket las interacciones de la madrugada.

CREATE OR REPLACE FUNCTION public.metrics_interactions_by_day(
  p_client_id UUID,
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ
)
RETURNS TABLE (day DATE, content_type TEXT, classification TEXT, n BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    ((i.bot_triggered_at AT TIME ZONE 'UTC')::date) AS day,
    cp.content_type,
    i.classification,
    count(*) AS n
  FROM interactions i
  LEFT JOIN content_pieces cp ON cp.id = i.content_id
  WHERE i.client_id = p_client_id
    AND i.bot_triggered_at >= p_start
    AND i.bot_triggered_at <= p_end
  GROUP BY 1, 2, 3;
$$;

GRANT EXECUTE ON FUNCTION public.metrics_interactions_by_day(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

COMMENT ON FUNCTION public.metrics_interactions_by_day IS
  'Conteos de interacciones por día, tipo de contenido de origen y clasificación. Reemplaza el traer todas las filas del rango para contarlas en memoria (ver src/lib/actions/live-metrics.ts).';
