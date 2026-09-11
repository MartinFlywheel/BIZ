-- 059 · Teléfono normalizado en leads
--
-- Problema: el CRM reconoce a cada persona por su usuario de Instagram. Los
-- leads que entran por WhatsApp (el agente externo, el lead magnet, Calendly)
-- muchas veces no traen Instagram, así que no hay forma de saber si ya
-- existen y se crean repetidos. Además, el mismo número se escribe de varias
-- formas: "+56 9 1234 5678", "912345678", "56912345678".
--
-- Solución: una columna `phone_e164` con el número en formato E.164
-- ("+56912345678"), rellenada por un trigger cada vez que cambia `phone`.
-- Así todas las vías de entrada (ManyChat, alta manual, lead magnet, API)
-- quedan consistentes sin tocar cada una.
--
-- Se asume Chile (+56) cuando el número llega sin código de país, porque hoy
-- todos los clientes operan ahí. Si un día hay clientes en otro país, la
-- función recibe el prefijo como segundo argumento.
--
-- Descartado: columna GENERATED. La regla del país por defecto podría
-- cambiar y el trigger es más flexible.
--
-- Esta migración NO crea el índice único todavía: si ya hay teléfonos
-- repetidos, la creación fallaría. Al final lista los duplicados que
-- existan para revisarlos a mano. El índice único va en la 061.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS phone_e164 TEXT;

-- Convierte cualquier forma de escribir un teléfono a E.164, o NULL si no
-- parece un teléfono. Misma lógica que src/lib/phone.ts: si cambias una,
-- cambia la otra.
CREATE OR REPLACE FUNCTION normalizar_telefono(entrada TEXT, pais_default TEXT DEFAULT '56')
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  crudo TEXT;
  digitos TEXT;
  con_mas BOOLEAN;
BEGIN
  IF entrada IS NULL THEN RETURN NULL; END IF;
  crudo := btrim(entrada);
  IF crudo = '' THEN RETURN NULL; END IF;

  con_mas := left(crudo, 1) = '+';
  digitos := regexp_replace(crudo, '\D', '', 'g');

  -- "0056..." es la forma antigua de marcar internacional.
  IF NOT con_mas AND left(digitos, 2) = '00' THEN
    digitos := substr(digitos, 3);
    con_mas := TRUE;
  END IF;

  IF digitos = '' THEN RETURN NULL; END IF;

  -- Con "+" delante, el número ya trae su código de país.
  IF con_mas THEN
    IF length(digitos) BETWEEN 8 AND 15 THEN RETURN '+' || digitos; END IF;
    RETURN NULL;
  END IF;

  -- Celular chileno de 9 dígitos que empieza en 9.
  IF length(digitos) = 9 AND left(digitos, 1) = '9' THEN
    RETURN '+' || pais_default || digitos;
  END IF;

  -- Celular chileno con un 0 delante ("0912345678").
  IF length(digitos) = 10 AND left(digitos, 2) = '09' THEN
    RETURN '+' || pais_default || substr(digitos, 2);
  END IF;

  -- Ya trae el 56 delante ("56912345678").
  IF length(digitos) = 11 AND left(digitos, 2) = pais_default THEN
    RETURN '+' || digitos;
  END IF;

  -- Celular chileno de 8 dígitos, sin el 9 inicial (forma vieja).
  IF length(digitos) = 8 THEN
    RETURN '+' || pais_default || '9' || digitos;
  END IF;

  -- Otro país sin "+": se acepta si tiene largo razonable.
  IF length(digitos) BETWEEN 10 AND 15 THEN
    RETURN '+' || digitos;
  END IF;

  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION normalizar_telefono(TEXT, TEXT) TO authenticated;

-- Mantiene phone_e164 al día cada vez que se inserta o cambia phone.
CREATE OR REPLACE FUNCTION leads_sync_phone_e164()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.phone_e164 := normalizar_telefono(NEW.phone);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_sync_phone_e164 ON leads;
CREATE TRIGGER trg_leads_sync_phone_e164
  BEFORE INSERT OR UPDATE OF phone ON leads
  FOR EACH ROW
  EXECUTE FUNCTION leads_sync_phone_e164();

-- Relleno de los leads que ya existen.
UPDATE leads
SET phone_e164 = normalizar_telefono(phone)
WHERE phone IS NOT NULL
  AND phone_e164 IS DISTINCT FROM normalizar_telefono(phone);

-- Índice normal para buscar por teléfono. El único va en la 061.
CREATE INDEX IF NOT EXISTS idx_leads_client_phone_e164
  ON leads(client_id, phone_e164)
  WHERE phone_e164 IS NOT NULL;

-- Revisión: teléfonos repetidos dentro de un mismo cliente. Si esta consulta
-- devuelve filas, hay que fusionar esos leads a mano antes de correr la 061.
SELECT c.name AS cliente, l.phone_e164, count(*) AS repetidos,
       string_agg(coalesce(l.full_name, l.ig_username, l.id::text), ' | ') AS leads
FROM leads l
JOIN clients c ON c.id = l.client_id
WHERE l.phone_e164 IS NOT NULL
GROUP BY c.name, l.phone_e164
HAVING count(*) > 1
ORDER BY repetidos DESC, c.name;
