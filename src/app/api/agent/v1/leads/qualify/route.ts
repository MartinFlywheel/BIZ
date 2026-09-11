import { NextResponse } from 'next/server'
import { pickBalancedSetter } from '@/lib/manychat'
import {
  conAgente, respuestaError, telefonoDelCuerpo, buscarLeadPorTelefono, leerLead, resumenLead,
} from '@/lib/agent-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/agent/v1/leads/qualify
// { phone, answers?: { pregunta: respuesta, ... } }
//
// Marca a la persona como lead calificado, igual que el nodo
// "lead-calificado" de ManyChat:
//  1. Si no tiene setter, le asigna uno con el mismo reparto balanceado.
//     Nunca pisa una asignación hecha a mano.
//  2. Registra una interacción con classification 'lead_calificado', que
//     es lo que usa el CRM para decidir qué ve cada setter.
// Se puede llamar dos veces sin efecto: la segunda vuelve a devolver el
// mismo setter y no crea otra interacción.
export async function POST(request: Request) {
  return conAgente(request, 'calificar', async ({ supabase, agente, body }) => {
    const { e164 } = telefonoDelCuerpo(body)
    if (!e164) return respuestaError('Falta el teléfono o no tiene un formato reconocible', 400)

    const lead = await buscarLeadPorTelefono(supabase, agente.clientId, e164)
    if (!lead) return respuestaError('No existe un lead con ese teléfono. Créalo primero con POST /api/agent/v1/leads', 404)

    const ahora = new Date().toISOString()
    const respuestas = (body.answers && typeof body.answers === 'object' ? body.answers : {}) as Record<string, unknown>

    // 1. Setter, solo si no tiene.
    let setterAsignado = false
    if (!lead.assigned_to) {
      const setterId = await pickBalancedSetter(supabase, agente.clientId)
      if (setterId) {
        const { error } = await supabase
          .from('leads')
          .update({ assigned_to: setterId, updated_at: ahora })
          .eq('id', lead.id)
          .is('assigned_to', null)
        if (error) throw error
        setterAsignado = true
      }
    }

    // 2. Interacción calificada, una sola vez por lead.
    let yaCalificado = false
    if (lead.interaction_id) {
      const { data } = await supabase
        .from('interactions')
        .select('classification')
        .eq('id', lead.interaction_id)
        .maybeSingle()
      yaCalificado = data?.classification === 'lead_calificado'
    }

    if (yaCalificado && lead.interaction_id) {
      if (Object.keys(respuestas).length > 0) {
        const { data } = await supabase
          .from('interactions')
          .select('prequalification_data')
          .eq('id', lead.interaction_id)
          .maybeSingle()
        await supabase
          .from('interactions')
          .update({
            prequalification_data: { ...((data?.prequalification_data as Record<string, unknown>) ?? {}), ...respuestas },
            updated_at: ahora,
          })
          .eq('id', lead.interaction_id)
      }
    } else {
      const { data: interaccion, error } = await supabase
        .from('interactions')
        .insert({
          client_id: agente.clientId,
          ig_username: lead.ig_username,
          prospect_name: lead.full_name,
          classification: 'lead_calificado',
          source: 'api',
          keyword_used: 'agente',
          bot_triggered_at: ahora,
          prospect_responded_at: ahora,
          qualified_at: ahora,
          prequalification_data: respuestas,
          promoted_to_lead: true,
        })
        .select('id')
        .single()
      if (error) throw error

      const { error: errorEnlace } = await supabase
        .from('leads')
        .update({ interaction_id: interaccion.id, updated_at: ahora })
        .eq('id', lead.id)
      if (errorEnlace) throw errorEnlace
    }

    const actualizado = (await leerLead(supabase, lead.id)) ?? lead
    const resumen = await resumenLead(supabase, actualizado)
    return NextResponse.json({
      qualified: true,
      setter_asignado_ahora: setterAsignado,
      sin_setters_disponibles: !actualizado.assigned_to,
      lead: resumen,
    })
  })
}
