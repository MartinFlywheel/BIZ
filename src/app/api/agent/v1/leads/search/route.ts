import { NextResponse } from 'next/server'
import { conAgente, respuestaError, telefonoDelCuerpo, buscarLeadPorTelefono, resumenLead } from '@/lib/agent-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/agent/v1/leads/search
// { phone }
//
// Igual que GET /api/agent/v1/leads?phone=..., pero con el teléfono en el
// cuerpo y no en la URL, para que no quede en los registros de acceso de
// Vercel. Es la forma recomendada; el GET se mantiene por compatibilidad.
export async function POST(request: Request) {
  return conAgente(request, 'buscar', async ({ supabase, agente, body }) => {
    const { e164 } = telefonoDelCuerpo(body)
    if (!e164) return respuestaError('Falta el teléfono o no tiene un formato reconocible', 400)

    const lead = await buscarLeadPorTelefono(supabase, agente.clientId, e164)
    if (!lead) return NextResponse.json({ found: false, telefono: e164 })
    return NextResponse.json({ found: true, lead: await resumenLead(supabase, lead) })
  })
}
