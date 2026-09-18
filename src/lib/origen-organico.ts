/**
 * Un lead que escribió por DM sin pasar por un keyword de ManyChat.
 *
 * Antes, al crear un lead a mano, el CTA era opcional y la setter lo dejaba
 * en "Sin CTA". En el panel "Lo que recibe marketing" eso salía como
 * "Sin origen", mezclado con lo que de verdad no se sabe. Ahora el
 * formulario obliga a elegir: una pieza de contenido o esta opción.
 *
 * Se guarda como first_touch_type = 'organico' (content_id queda vacío) y la
 * agenda lo recibe como de_donde_vino = 'Orgánico' (supabase/083). Tener
 * first_touch_type también lo saca de la limpieza nocturna de
 * prune-stale-leads, que borra los leads sin origen ni interacciones: un
 * lead que una setter creó a propósito no es basura.
 */
export const FIRST_TOUCH_ORGANICO = 'organico'

/** Valor del <select> de CTA para esta opción; nunca llega a content_id. */
export const OPCION_ORGANICO = '__organico__'

export const ETIQUETA_ORGANICO = 'DM directo / orgánico'

/** Lo que va en agenda_records.de_donde_vino. */
export const CODIGO_ORGANICO = 'Orgánico'
