import { NextResponse } from 'next/server'
import {
  conAgente, respuestaError, telefonoDelCuerpo, texto,
  buscarLeadPorTelefono, leerLead, etapasDelCliente, etapasPermitidasAlAgente, resolverEtapa, resumenLead,
} from '@/lib/agent-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/agent/v1/leads/stage
// { phone, stage }
//
// Cambia la etapa del pipeline. Solo acepta las etapas configuradas para
// ese cliente (o las del CRM si no tiene propias) y que el agente tenga
// permitido poner: quedan fuera "agendado", que la pone sola la lectura de
// Calendly junto con la fila de agenda, y "cierre", que decide el closer.
// Se acepta por id o por nombre visible. Cualquier otra responde 422 con la
// lista válida.
export async function POST(request: Request) {
  return conAgente(request, 'etapa', async ({ supabase, agente, body }) => {
    const { e164 } = telefonoDelCuerpo(body)
    if (!e164) return respuestaError('Falta el teléfono o no tiene un formato reconocible', 400)

    const valor = texto(body, 'stage', 'etapa')
    if (!valor) return respuestaError('Falta la etapa', 400)

    const etapas = etapasPermitidasAlAgente(await etapasDelCliente(supabase, agente.clientId))
    const etapa = resolverEtapa(etapas, valor)
    if (!etapa) {
      return respuestaError('Etapa no válida o no permitida para el agente', 422, {
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
    const { error } = await supabase.from('leads').update(cambios).eq('id', lead.id)
    if (error) throw error

    const actualizado = (await leerLead(supabase, lead.id)) ?? lead
    return NextResponse.json({
      etapa_anterior: lead.stage,
      lead: await resumenLead(supabase, actualizado),
    })
  })
}
