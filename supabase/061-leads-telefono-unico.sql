-- 061 · Un teléfono por cliente
--
-- Cierra lo que abrió la 059: impide que dos leads del mismo cliente
-- compartan phone_e164. Con esto, "crear o actualizar por teléfono" desde la
-- API no puede producir repetidos aunque lleguen dos llamadas a la vez.
--
-- Va separada de la 059 porque, si ya existen repetidos, el índice no se
-- puede crear. Primero se revisa la consulta del final de la 059 y se
-- fusionan a mano; después se corre esta. Si todavía quedan repetidos, esta
-- migración se detiene con un mensaje claro en vez de fallar a medias.

DO $$
DECLARE
  repetidos INT;
BEGIN
  SELECT count(*) INTO repetidos
  FROM (
    SELECT client_id, phone_e164
    FROM leads
    WHERE phone_e164 IS NOT NULL
    GROUP BY client_id, phone_e164
    HAVING count(*) > 1
  ) d;

  IF repetidos > 0 THEN
    RAISE EXCEPTION 'Hay % teléfonos repetidos. Corre la consulta del final de la 059, fusiona esos leads y vuelve a intentar.', repetidos;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_client_phone_e164
  ON leads(client_id, phone_e164)
  WHERE phone_e164 IS NOT NULL;
