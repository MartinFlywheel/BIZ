-- 060 · Llaves de acceso por cliente para la API del agente
--
-- Problema: un sistema externo (el agente de WhatsApp) necesita crear y
-- consultar leads en el CRM. No puede iniciar sesión como una persona, y no
-- queremos una sola contraseña global que abra los datos de todos los
-- clientes.
--
-- Solución: una tabla con llaves, cada una atada a un cliente. La llave se
-- guarda solo como hash SHA-256; el texto real se muestra una única vez al
-- crearla. Si se filtra, se marca revoked_at y se crea otra, sin deploy.
--
-- Descartado: una columna api_key en clients. No permite tener dos llaves
-- vivas durante una rotación ni saber cuál se usó por última vez.
--
-- Para crear una llave, correr en el editor SQL:
--   SELECT crear_api_key_cliente('<uuid del cliente>', 'agente whatsapp');
-- Devuelve el texto de la llave. Cópialo en ese momento: no se puede volver
-- a ver.

-- En Supabase pgcrypto vive en el esquema `extensions`, no en `public`. Como
-- las funciones fijan search_path = public, hay que llamar a gen_random_bytes
-- y digest con el esquema delante o no las encuentra (error 42883).
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS client_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- SHA-256 en hexadecimal del texto de la llave.
  key_hash TEXT NOT NULL UNIQUE,
  -- Primeros caracteres, para reconocerla en un listado sin exponerla.
  key_prefix TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_client_api_keys_client ON client_api_keys(client_id);

ALTER TABLE client_api_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agency_full_access" ON client_api_keys;
CREATE POLICY "agency_full_access" ON client_api_keys FOR ALL USING (get_user_type() = 'agency');

-- Genera una llave nueva, guarda su hash y devuelve el texto en claro.
-- Formato: "bzk_" + 40 caracteres hexadecimales.
CREATE OR REPLACE FUNCTION crear_api_key_cliente(p_client_id UUID, p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  llave TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM clients WHERE id = p_client_id) THEN
    RAISE EXCEPTION 'No existe un cliente con id %', p_client_id;
  END IF;

  llave := 'bzk_' || encode(extensions.gen_random_bytes(20), 'hex');

  INSERT INTO client_api_keys (client_id, name, key_hash, key_prefix)
  VALUES (p_client_id, p_name, encode(extensions.digest(llave, 'sha256'), 'hex'), left(llave, 10));

  RETURN llave;
END;
$$;

GRANT EXECUTE ON FUNCTION crear_api_key_cliente(UUID, TEXT) TO authenticated;

-- Anula una llave. Las llamadas con esa llave responden 401 desde ese momento.
CREATE OR REPLACE FUNCTION revocar_api_key_cliente(p_key_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE client_api_keys SET revoked_at = now() WHERE id = p_key_id AND revoked_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION revocar_api_key_cliente(UUID) TO authenticated;
