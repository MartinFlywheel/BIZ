import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Código de la pieza de contenido de la que vino un lead (H_15_07, R_23_07...),
 * que es lo que va en agenda_records.de_donde_vino (la columna CTA).
 *
 * Orden: la pieza del lead (content_id), la del primer contacto
 * (first_touch_content_id) y, para leads antiguos sin pieza resuelta, el
 * "manychat:{código}" de first_touch_type. null si no hay ninguna.
 *
 * El sync de calendario guardaba aquí el nombre del evento de Calendly
 * ("30 Minute Meeting"), que no es un origen, y el panel de marketing lo
 * mostraba como si fuera una campaña.
 */
export async function codigoDeOrigenDelLead(supabase: SupabaseClient, leadId: string | null): Promise<string | null> {
  if (!leadId) return null

  const { data: lead } = await supabase
    .from('leads')
    .select('content_id, first_touch_content_id, first_touch_type')
    .eq('id', leadId)
    .maybeSingle()
  if (!lead) return null

  for (const contentId of [lead.content_id, lead.first_touch_content_id] as (string | null)[]) {
    if (!contentId) continue
    const { data: pieza } = await supabase
      .from('content_pieces')
      .select('keyword_trigger')
      .eq('id', contentId)
      .maybeSingle()
    if (pieza?.keyword_trigger) return pieza.keyword_trigger as string
  }

  return (lead.first_touch_type as string | null)?.match(/^manychat:(.+)$/)?.[1] || null
}
