import { NextResponse } from 'next/server'
import { LEAD_EVENTS } from '@/lib/types'
import {
  conAgente, respuestaError, telefonoDelCuerpo,
  buscarLeadPorTelefono, leerLead, resolverEtiqueta, resumenLead,
} from '@/lib/agent-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function lista(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  if (typeof v === 'string' && v.trim()) return v.split(',').map((s) => s.trim()).filter(Boolean)
  return []
}

// POST /api/agent/v1/leads/tags
// { phone, add?: ["Calendly Enviado"], remove?: ["Seguimiento 1"] }
//
// Pone o quita etiquetas. Son las mismas marcas que usan los setters en el
// CRM (LEAD_EVENTS), así que solo se aceptan esas; una desconocida responde
// 422 con la lista válida. Poner una que ya está o quitar una que no está
// no es error.
export async function POST(request: Request) {
  return conAgente(request, 'etiquetas', async ({ supabase, agente, body }) => {
    const { e164 } = telefonoDelCuerpo(body)
    if (!e164) return respuestaError('Falta el teléfono o no tiene un formato reconocible', 400)

    const agregar = lista(body.add ?? body.agregar)
    const quitar = lista(body.remove ?? body.quitar)
    if (agregar.length === 0 && quitar.length === 0) return respuestaError('Indica qué etiquetas agregar o quitar', 400)

    const desconocidas: string[] = []
    const agregarOk: string[] = []
    const quitarOk: string[] = []
    for (const t of agregar) {
      const c = resolverEtiqueta(t)
      if (c) agregarOk.push(c); else desconocidas.push(t)
    }
    for (const t of quitar) {
      const c = resolverEtiqueta(t)
      if (c) quitarOk.push(c); else desconocidas.push(t)
    }
    if (desconocidas.length > 0) {
      return respuestaError('Etiqueta no válida', 422, { desconocidas, etiquetas_validas: [...LEAD_EVENTS] })
    }

    const lead = await buscarLeadPorTelefono(supabase, agente.clientId, e164)
    if (!lead) return respuestaError('No existe un lead con ese teléfono. Créalo primero con POST /api/agent/v1/leads', 404)

    const actuales = lead.events ?? []
    const nuevas = [...actuales.filter((e) => !quitarOk.includes(e)), ...agregarOk.filter((e) => !actuales.includes(e))]

    if (nuevas.join('|') !== actuales.join('|')) {
      const { error } = await supabase
        .from('leads')
        .update({ events: nuevas, updated_at: new Date().toISOString() })
        .eq('id', lead.id)
      if (error) throw error
    }

    const actualizado = (await leerLead(supabase, lead.id)) ?? lead
    return NextResponse.json({ lead: await resumenLead(supabase, actualizado) })
  })
}
