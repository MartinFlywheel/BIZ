/*
  064 · Sumar chats nuevos sin perder llamadas simultáneas

  Problema: el webhook de ManyChat sumaba chats_nuevos leyendo el valor y
  escribiendo valor + 1 en dos pasos. Dos llamadas al mismo tiempo leían el
  mismo número y una de las sumas se perdía. Además, si la fila de
  content_metrics no existía, dos llamadas simultáneas podían crear dos.

  Solución: una función que hace el UPSERT y la suma en una sola sentencia,
  que Postgres ejecuta de forma atómica. El código la llama por RPC y, si
  todavía no existe (esta migración sin correr), vuelve al método anterior.

  content_metrics.content_id ya es UNIQUE desde schema.sql, así que el
  ON CONFLICT funciona sin índices nuevos.
*/

CREATE OR REPLACE FUNCTION incrementar_chats_nuevos(p_content_id UUID, p_client_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  INSERT INTO content_metrics (content_id, client_id, chats_nuevos, updated_at)
  VALUES (p_content_id, p_client_id, 1, now())
  ON CONFLICT (content_id) DO UPDATE
    SET chats_nuevos = COALESCE(content_metrics.chats_nuevos, 0) + 1,
        updated_at = now();
$$;

GRANT EXECUTE ON FUNCTION incrementar_chats_nuevos(UUID, UUID) TO authenticated;
