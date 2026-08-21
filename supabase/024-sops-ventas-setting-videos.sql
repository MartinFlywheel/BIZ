-- Seed SOP videos (Vimeo) for the Ventas and Setting categories.
-- attachments column may already exist in production; IF NOT EXISTS keeps this safe to re-run.
ALTER TABLE sops ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

-- Each attachment needs both `url` (plain vimeo.com link, used by the
-- external-link icon) and `embed_url` (player.vimeo.com link, used by the
-- inline "Vista previa" iframe in sop-form.tsx) — without embed_url the
-- preview toggle never appears.

-- VENTAS (Conversión de leads)
INSERT INTO sops (title, category, tags, attachments, content) VALUES
('Proceso de agendamiento B2B', 'Ventas', '{"Ventas"}', '[{"id": "vimeo-1160888060", "type": "vimeo", "url": "https://vimeo.com/1160888060", "title": "Proceso de agendamiento B2B", "embed_url": "https://player.vimeo.com/video/1160888060?title=0&byline=0&portrait=0&autoplay=1&autopause=0&app_id=122963"}]'::jsonb, ''),
('Proceso de agendamiento B2C', 'Ventas', '{"Ventas"}', '[{"id": "vimeo-1160888006", "type": "vimeo", "url": "https://vimeo.com/1160888006", "title": "Proceso de agendamiento B2C", "embed_url": "https://player.vimeo.com/video/1160888006?title=0&byline=0&portrait=0&autoplay=1&autopause=0&app_id=122963"}]'::jsonb, ''),
('Proceso de nutrición', 'Ventas', '{"Ventas"}', '[{"id": "vimeo-1160888043", "type": "vimeo", "url": "https://vimeo.com/1160888043", "title": "Proceso de nutrición", "embed_url": "https://player.vimeo.com/video/1160888043?title=0&byline=0&portrait=0&autoplay=1&autopause=0&app_id=122963"}]'::jsonb, ''),
('Proceso de triaje y pre-triaje', 'Ventas', '{"Ventas"}', '[{"id": "vimeo-1160887978", "type": "vimeo", "url": "https://vimeo.com/1160887978", "title": "Proceso de triaje y pre-triaje", "embed_url": "https://player.vimeo.com/video/1160887978?title=0&byline=0&portrait=0&autoplay=1&autopause=0&app_id=122963"}]'::jsonb, ''),
('Closer vs Experto En Ventas', 'Ventas', '{"Ventas"}', '[{"id": "vimeo-1160888516", "type": "vimeo", "url": "https://vimeo.com/1160888516", "title": "Closer vs Experto En Ventas", "embed_url": "https://player.vimeo.com/video/1160888516?title=0&byline=0&portrait=0&autoplay=1&autopause=0&app_id=122963"}]'::jsonb, ''),
('Estructura de llamada', 'Ventas', '{"Ventas"}', '[{"id": "vimeo-1160888208", "type": "vimeo", "url": "https://vimeo.com/1160888208", "title": "Estructura de llamada", "embed_url": "https://player.vimeo.com/video/1160888208?title=0&byline=0&portrait=0&autoplay=1&autopause=0&app_id=122963"}]'::jsonb, ''),
('Resolución de objeciones', 'Ventas', '{"Ventas"}', '[{"id": "vimeo-1160888089", "type": "vimeo", "url": "https://vimeo.com/1160888089", "title": "Resolución de objeciones", "embed_url": "https://player.vimeo.com/video/1160888089?title=0&byline=0&portrait=0&autoplay=1&autopause=0&app_id=122963"}]'::jsonb, '');

-- SETTING
INSERT INTO sops (title, category, tags, attachments, content) VALUES
('Cuándo el descubrimiento está terminado?', 'Setting', '{"Setting"}', '[{"id": "vimeo-1166204130", "type": "vimeo", "url": "https://vimeo.com/1166204130", "title": "Cuándo el descubrimiento está terminado?", "embed_url": "https://player.vimeo.com/video/1166204130?title=0&byline=0&portrait=0&autoplay=1&autopause=0&app_id=122963"}]'::jsonb, ''),
('Cuántos follow-ups hago?', 'Setting', '{"Setting"}', '[{"id": "vimeo-1166204232", "type": "vimeo", "url": "https://vimeo.com/1166204232", "title": "Cuántos follow-ups hago?", "embed_url": "https://player.vimeo.com/video/1166204232?title=0&byline=0&portrait=0&autoplay=1&autopause=0&app_id=122963"}]'::jsonb, ''),
('Calificación de avatar en 1-2 preguntas', 'Setting', '{"Setting"}', '[{"id": "vimeo-1166204197", "type": "vimeo", "url": "https://vimeo.com/1166204197", "title": "Calificación de avatar en 1-2 preguntas", "embed_url": "https://player.vimeo.com/video/1166204197?title=0&byline=0&portrait=0&autoplay=1&autopause=0&app_id=122963"}]'::jsonb, ''),
('Volumen vs Eficiencia', 'Setting', '{"Setting"}', '[{"id": "vimeo-1166204044", "type": "vimeo", "url": "https://vimeo.com/1166204044", "title": "Volumen vs Eficiencia", "embed_url": "https://player.vimeo.com/video/1166204044?title=0&byline=0&portrait=0&autoplay=1&autopause=0&app_id=122963"}]'::jsonb, ''),
('Cómo hacer que se presenten a todas tus llamadas', 'Setting', '{"Setting"}', '[{"id": "vimeo-1166203994", "type": "vimeo", "url": "https://vimeo.com/1166203994", "title": "Cómo hacer que se presenten a todas tus llamadas", "embed_url": "https://player.vimeo.com/video/1166203994?title=0&byline=0&portrait=0&autoplay=1&autopause=0&app_id=122963"}]'::jsonb, ''),
('Reactivación de leads perdidos', 'Setting', '{"Setting"}', '[{"id": "vimeo-1166204305", "type": "vimeo", "url": "https://vimeo.com/1166204305", "title": "Reactivación de leads perdidos", "embed_url": "https://player.vimeo.com/video/1166204305?title=0&byline=0&portrait=0&autoplay=1&autopause=0&app_id=122963"}]'::jsonb, ''),
('Prospección outbound', 'Setting', '{"Setting"}', '[{"id": "vimeo-1166210496", "type": "vimeo", "url": "https://vimeo.com/1166210496", "title": "Prospección outbound", "embed_url": "https://player.vimeo.com/video/1166210496?title=0&byline=0&portrait=0&autoplay=1&autopause=0&app_id=122963"}]'::jsonb, '');
