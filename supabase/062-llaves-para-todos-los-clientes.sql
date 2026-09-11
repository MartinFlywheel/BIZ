-- 062 · Una llave del agente para cada cliente, de una sola vez
--
-- Crear las llaves una por una exige conocer el uuid de cada cliente y
-- pegar un SELECT por cada uno. Este texto lo hace para todos los clientes
-- que todavía no tengan una llave viva y muestra una tabla con nombre de
-- cliente y llave.
--
-- Se puede correr las veces que se quiera: los clientes que ya tienen
-- llave vigente se saltan, así que no se generan repetidas. Para rotar la
-- llave de un cliente, primero se revoca la vieja
-- (SELECT revocar_api_key_cliente('<id>')) y se vuelve a correr esto.
--
-- Requiere la migración 060.
--
-- Sin tabla temporal a propósito: el editor de Supabase avisa por cualquier
-- CREATE TABLE sin RLS, aunque sea TEMP, y confunde.
--
-- IMPORTANTE: la llave se muestra solo esta vez. Copia la tabla completa
-- antes de cerrar el editor.

SELECT c.name AS cliente, crear_api_key_cliente(c.id, 'agente whatsapp') AS llave
FROM clients c
WHERE c.status IN ('active', 'onboarding')
  AND NOT EXISTS (
    SELECT 1 FROM client_api_keys k
    WHERE k.client_id = c.id AND k.revoked_at IS NULL
  )
ORDER BY c.name;
