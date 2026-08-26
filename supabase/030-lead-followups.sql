-- Agrega campos para el flujo de seguimientos en el CRM

ALTER TABLE leads
ADD COLUMN next_follow_up_date timestamptz,
ADD COLUMN follow_up_count int4 NOT NULL DEFAULT 0;

-- Para asegurar que funcione con RLS y el resto de operaciones, se documentan estos campos
COMMENT ON COLUMN leads.next_follow_up_date IS 'Fecha en la que este lead debe aparecer en la lista de Seguimientos Programados.';
COMMENT ON COLUMN leads.follow_up_count IS 'Cantidad de intentos de seguimiento fallidos.';
