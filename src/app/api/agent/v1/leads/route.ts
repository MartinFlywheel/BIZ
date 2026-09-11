import { NextResponse } from 'next/server'
import {
  conAgente, respuestaError, telefonoDelCuerpo, texto, limpiarInstagram, referralDelCuerpo,
  buscarLeadPorTelefono, buscarLeadPorInstagram, leerLead, etapasDelCliente, resumenLead,
  type AdminClient,
} from '@/lib/agent-api'

const COLUMNA_INEXISTENTE = '42703'

/**
 * Guarda el anuncio de origen solo si la columna existe (migración 065) y
 * el lead no tenía uno: el primer anuncio es el que atrae, no el último.
 * Nunca lanza; si la migración falta, el lead queda igual sin ese dato.
 */
async function guardarReferral(supabase: AdminClient, leadId: string, referral: Record<string, unknown> | null) {
  if (!referral) return
  const { error } = await supabase
    .from('leads')
    .update({ referral })
    .eq('id', leadId)
    .is('referral', null)
  if (error && error.code !== COLUMNA_INEXISTENTE) throw error
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/agent/v1/leads?phone=%2B56912345678
// Busca a la persona por teléfono. Responde 200 con { found: false } si no
// existe, para que el agente no tenga que tratar el 404 como error.
export async function GET(request: Request) {
  return conAgente(request, 'buscar', async ({ supabase, agente, body }) => {
    const { e164 } = telefonoDelCuerpo(body)
    if (!e164) return respuestaError('Falta el teléfono o no tiene un formato reconocible', 400)

    const lead = await buscarLeadPorTelefono(supabase, agente.clientId, e164)
    if (!lead) return NextResponse.json({ found: false, telefono: e164 })
    return NextResponse.json({ found: true, lead: await resumenLead(supabase, lead) })
  })
}

// POST /api/agent/v1/leads
// { phone, full_name?, ig_username?, email?, source?, referral? }
// Crea a la persona si no existe, o completa sus datos si ya está. Nunca
// pisa un dato existente con uno vacío. Devuelve created: true|false.
export async function POST(request: Request) {
  return conAgente(request, 'crear-o-actualizar', async ({ supabase, agente, body }) => {
    const { e164, crudo } = telefonoDelCuerpo(body)
    if (!e164) return respuestaError('Falta el teléfono o no tiene un formato reconocible', 400, { recibido: crudo })

    const nombre = texto(body, 'full_name', 'nombre', 'name')
    const instagram = limpiarInstagram(texto(body, 'ig_username', 'instagram', 'username'))
    const email = texto(body, 'email', 'correo')?.toLowerCase() ?? null
    const origen = (texto(body, 'source', 'origen') ?? 'agente').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'agente'
    const referral = referralDelCuerpo(body)

    // Primero por teléfono. Si no está, por Instagram: puede ser un lead que
    // entró por ManyChat sin teléfono y ahora lo escribe por WhatsApp.
    let lead = await buscarLeadPorTelefono(supabase, agente.clientId, e164)
    if (!lead && instagram) lead = await buscarLeadPorInstagram(supabase, agente.clientId, instagram)

    if (lead) {
      const cambios: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (!lead.phone) cambios.phone = e164
      if (nombre && !lead.full_name) cambios.full_name = nombre
      if (instagram && !lead.ig_username) cambios.ig_username = instagram
      if (email && !lead.email) cambios.email = email
      if (Object.keys(cambios).length > 1) {
        const { error } = await supabase.from('leads').update(cambios).eq('id', lead.id)
        if (error) throw error
        lead = (await leerLead(supabase, lead.id)) ?? lead
      }
      await guardarReferral(supabase, lead.id, referral)
      return NextResponse.json({ created: false, lead: await resumenLead(supabase, lead) })
    }

    const etapas = await etapasDelCliente(supabase, agente.clientId)
    const ahora = new Date().toISOString()
    const { data: nuevo, error } = await supabase
      .from('leads')
      .insert({
        client_id: agente.clientId,
        phone: e164,
        full_name: nombre,
        ig_username: instagram,
        email,
        stage: etapas[0]?.id ?? 'nuevo_contacto',
        first_touch_at: ahora,
        // El prefijo "agent:" es lo que protege a estos leads de la limpieza
        // nocturna (prune-stale-leads). No cambiarlo.
        first_touch_type: `agent:${origen}`,
      })
      .select('id')
      .single()

    if (error) {
      // Dos llamadas simultáneas con el mismo teléfono: la segunda choca con
      // el índice único de la 061. Se devuelve la que ganó.
      if (error.code === '23505') {
        const existente = await buscarLeadPorTelefono(supabase, agente.clientId, e164)
        if (existente) return NextResponse.json({ created: false, lead: await resumenLead(supabase, existente) })
      }
      throw error
    }

    await guardarReferral(supabase, nuevo.id, referral)

    const creado = await leerLead(supabase, nuevo.id)
    if (!creado) throw new Error('El lead se creó pero no se pudo volver a leer')
    return NextResponse.json({ created: true, lead: await resumenLead(supabase, creado) }, { status: 201 })
  })
}
