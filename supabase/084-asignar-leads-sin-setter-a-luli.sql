-- =====================================================
-- 084 — Asignar a Luli los leads de Mane sin setter en seguimiento
-- =====================================================
--
-- EL PROBLEMA
-- 60 leads de Mane en etapas de seguimiento (conversando, micro_vsl_enviado,
-- vsl_chat, calendly_enviado) no tienen setter. No aparecen en la cola de
-- nadie: solo los ve un admin con el filtro "Todos los setters".
--
-- QUÉ SE DECIDIÓ
-- Todos a Luli, con el mismo criterio que pickBalancedSetter
-- (src/lib/manychat.ts): carga actual dividida por lead_weight. Al
-- 2026-09-18, Luli tenía 134 leads con peso 3 y Magui 2.376 con peso 4, así
-- que el reparto equilibrado los manda todos a Luli.
--
-- updated_at no se toca a propósito: la pestaña Seguimientos lo usa para
-- decidir qué es "para hacer ahora" y qué está frío. Reasignar no es un
-- seguimiento.
--
-- Idempotente: la segunda corrida no encuentra leads sin setter.

UPDATE leads
SET assigned_to = '304c88ef-75b9-4d03-8e43-a4f26412224a' -- Luli
WHERE client_id = 'ad9b2e47-aac9-4585-9aee-95f956fa4261' -- Mane
  AND assigned_to IS NULL
  AND stage IN ('conversando', 'micro_vsl_enviado', 'vsl_chat', 'calendly_enviado');

-- Verificación: debe devolver 0.
SELECT count(*) AS sin_setter
FROM leads
WHERE client_id = 'ad9b2e47-aac9-4585-9aee-95f956fa4261'
  AND assigned_to IS NULL
  AND stage IN ('conversando', 'micro_vsl_enviado', 'vsl_chat', 'calendly_enviado');
