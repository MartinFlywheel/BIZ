import { NextResponse } from 'next/server'
import {
  conAgente, respuestaError, telefonoDelCuerpo, texto,
  buscarLeadPorTelefono, leerLead, etapasDelCliente, resolverEtapa, resumenLead,
} from '@/lib/agent-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/agent/v1/leads/stage
// { phone, stage }
//
// Cambia la etapa del pipeline. Solo acepta las etapas configuradas para
// ese cliente (o las del CRM si no tiene propias), por id o por nombre
// visible. Cualquier otra responde 422 con la lista válida, para que el
// agente no siga sembrando etapas que ningún tablero muestra.
export async function POST(request: Request) {
  return conAgente(request, 'etapa', async ({ supabase, agente, body }) => {
    const { e164 } = telefonoDelCuerpo(body)
    if (!e164) return respuestaError('Falta el teléfono o no tiene un formato reconocible', 400)

    const valor = texto(body, 'stage', 'etapa')
    if (!valor) return respuestaError('Falta la etapa', 400)

    const etapas = await etapasDelCliente(supabase, agente.clientId)
    const etapa = resolverEtapa(etapas, valor)
    if (!etapa) {
      return respuestaError('Etapa no válida para este cliente', 422, {
        etapas_validas: etapas.map((e) => ({ id: e.id, nombre: e.label })),
      })
    }

    const lead = await buscarLeadPorTelefono(supabase, agente.clientId, e164)
    if (!lead) return respuestaError('No existe un lead con ese teléfono. Créalo primero con POST /api/agent/v1/leads', 404)

    const ahora = new Date().toISOString()
    const cambios: Record<string, unknown> = {
      stage: etapa.id,
      updated_at: ahora,
      // Mismo efecto que mover la etapa a mano: se reinicia el seguimiento.
      next_follow_up_date: null,
      follow_up_count: 0,
    }
    if (etapa.id === 'agendado' || etapa.id === 'agenda_set') cambios.agenda_at = ahora
    if (etapa.id === 'cliente' || etapa.id === 'closed_won') cambios.closed_at = ahora

    const { error } = await supabase.from('leads').update(cambios).eq('id', lead.id)
    if (error) throw error

    const actualizado = (await leerLead(supabase, lead.id)) ?? lead
    return NextResponse.json({
      etapa_anterior: lead.stage,
      lead: await resumenLead(supabase, actualizado),
    })
  })
}
