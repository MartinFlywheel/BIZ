import { createClient } from '@/lib/supabase/server'

/**
 * Quién puede ver un lead, en un solo lugar.
 *
 * Vivía dentro de lead-chat.ts; la línea de tiempo necesita exactamente la
 * misma regla y copiarla era garantizar que tarde o temprano divergieran.
 *
 * A propósito este archivo NO lleva 'use server': cada export de un archivo
 * así queda publicado como endpoint POST, y esto es un chequeo interno que
 * solo deben llamar otras server actions.
 *
 * La regla:
 * - Sin sesión, nada.
 * - Usuarios del portal (user_type 'client'), nunca: la historia concentra
 *   mensajes, respuestas del formulario y resúmenes de llamadas.
 * - Quien no es admin solo ve leads de su propio cliente. El middleware ya lo
 *   confina a /clients/{su client_id}, pero el leadId de la URL podría ser de
 *   otro cliente, y la RLS de leads deja leer todo a cualquier usuario de la
 *   agencia.
 * - Un setter ve todo menos el lead ya calificado de otro setter (misma regla
 *   que getLeadsForViewer en src/lib/actions/leads.ts).
 */
export async function assertCanViewLead(leadId: string) {
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) throw new Error('No autenticado')

  const { data: viewer } = await supabase
    .from('users')
    .select('role, user_type, client_id')
    .eq('id', authUser.id)
    .single()

  if (!viewer || viewer.user_type === 'client') throw new Error('No tienes acceso a este lead')

  const isAdmin = viewer.role === 'admin'
  const isSetter = viewer.role === 'setter'

  const { data: lead, error } = await supabase
    .from('leads')
    .select('id, client_id, assigned_to, ig_username, full_name, interactions(classification)')
    .eq('id', leadId)
    .single()

  if (error || !lead) throw new Error('Lead no encontrado')

  if (!isAdmin && viewer.client_id !== lead.client_id) {
    throw new Error('No tienes acceso a este lead')
  }

  if (isSetter) {
    const classification = (lead as { interactions?: { classification?: string } | null }).interactions?.classification
    const isQualifiedForSomeoneElse = classification === 'lead_calificado' && lead.assigned_to && lead.assigned_to !== authUser.id
    if (isQualifiedForSomeoneElse) throw new Error('No tienes acceso a este lead')
  }

  return {
    supabase,
    lead,
    currentUserId: authUser.id,
    viewer: { role: viewer.role as string | null, clientId: viewer.client_id as string | null, isAdmin, isSetter },
  }
}
