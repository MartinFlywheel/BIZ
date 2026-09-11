/*
  065 · Anuncio de origen del lead

  Problema: las personas que llegan por un anuncio de WhatsApp ("click to
  WhatsApp") traen datos del anuncio (referral: id, titular, origen), pero
  el CRM no tenía dónde guardarlos, así que esos leads quedaban sin
  atribución al anuncio.

  Solución: una columna JSONB opcional en leads. Se guarda tal como llega
  desde el agente; no se fija un esquema para que Meta pueda agregar campos
  sin cambiar código. Solo se escribe al crear el lead o si estaba vacía:
  el primer anuncio es el que atrae, no el último.

  El código degrada si esta migración no se corrió: si la columna no
  existe, crea el lead sin ese dato.
*/

ALTER TABLE leads ADD COLUMN IF NOT EXISTS referral JSONB;

COMMENT ON COLUMN leads.referral IS
  'Datos del anuncio que originó el contacto (referral de WhatsApp/Meta), tal como los envió el agente.';
