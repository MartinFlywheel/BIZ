-- =====================================================
-- 085 — Responsables de las metas del embudo en Mane
-- =====================================================
--
-- EL PROBLEMA
-- El aviso diario de metas (api/cron/check-benchmarks) le avisa a quien esté
-- asignado al área de cada etapa en rojo: Contenido, Setting o Closing
-- (src/lib/embudo.ts). En team_assignments solo había "Dirección de ventas",
-- así que el aviso llevaba meses corriendo con 0 notificaciones.
--
-- QUÉ SE DECIDIÓ (Martín, 2026-09-18)
--   - Contenido (tasa de chats y de conversaciones): Martin Senel.
--   - Setting (tasa de agendas y de shows): Magui y Luli.
--   - Closing (tasa de cierres): Maria Lucia.
-- Fabian sigue en Dirección de ventas, sin cambios.
--
-- Idempotente: ON CONFLICT contra la restricción única
-- (client_id, user_id, responsibility).

INSERT INTO team_assignments (client_id, user_id, responsibility, is_primary)
VALUES
  ('ad9b2e47-aac9-4585-9aee-95f956fa4261', '684e10e3-a211-4c45-9eab-dc3ff43b35cc', 'content', true),  -- Martin Senel
  ('ad9b2e47-aac9-4585-9aee-95f956fa4261', 'bdc9d37f-6bf6-4e60-8eea-2fc7247bdeed', 'setting', true),  -- Magui
  ('ad9b2e47-aac9-4585-9aee-95f956fa4261', '304c88ef-75b9-4d03-8e43-a4f26412224a', 'setting', false), -- Luli
  ('ad9b2e47-aac9-4585-9aee-95f956fa4261', 'a1623e2f-37fa-4594-828e-f12becd7ab5c', 'closing', true)   -- Maria Lucia
ON CONFLICT (client_id, user_id, responsibility) DO NOTHING;

-- Verificación: las cinco asignaciones de Mane.
SELECT u.full_name, t.responsibility, t.is_primary
FROM team_assignments t
JOIN users u ON u.id = t.user_id
WHERE t.client_id = 'ad9b2e47-aac9-4585-9aee-95f956fa4261'
ORDER BY t.responsibility, u.full_name;
