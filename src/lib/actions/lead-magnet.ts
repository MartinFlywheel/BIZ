'use server'

import { neon } from '@neondatabase/serverless'
import { createClient } from '@/lib/supabase/server'
import {
  type LeadResearch,
  type LeadResearchDetalle,
  type PlanLead,
  type SeguimientoLead,
  SEGUIMIENTOS,
  semaforoPorIngreso,
} from '@/lib/lead-magnet/research'

/**
 * Lectura y escritura sobre la base Neon de la landing de Carol.
 *
 * `LEAD_MAGNET_DATABASE_URL` es la misma cadena que la landing tiene como
 * `DATABASE_URL` en Vercel. Si no está configurada, todo aquí devuelve
 * `configurado: false` en vez de reventar: la pestaña muestra qué falta y el
 * resto del detalle del cliente sigue funcionando.
 */

const URL_BD = process.env.LEAD_MAGNET_DATABASE_URL || ''

function sql() {
  return neon(URL_BD)
}

/**
 * Los datos de las personas son privados: solo los usuarios de la agencia
 * (admin o equipo) pueden verlos. Los usuarios del portal de clientes no.
 */
async function assertAgencia() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')

  const { data: caller } = await supabase
    .from('users')
    .select('user_type')
    .eq('id', user.id)
    .single()

  if (!caller || caller.user_type !== 'agency') {
    throw new Error('Solo el equipo de la agencia puede ver esta información')
  }
}

// La consulta devuelve `creado` como texto ISO: un Date no viaja por la
// frontera de un server action y el driver lo convertiría a Date por defecto.
const COLUMNAS_LISTA = `
  id,
  to_char(creado AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS creado,
  estado, whatsapp, pais, ocupacion, seguimiento, notas, error,
  ig_username, lead_id,
  respuestas->>13 AS edad,
  respuestas->>15 AS ingreso,
  plan->'patron' AS patron,
  plan->>'resumen_equipo' AS resumen_equipo,
  COALESCE((plan->>'riesgo')::boolean, false) AS riesgo
`

function aLead(fila: Record<string, unknown>): LeadResearch {
  const ingreso = (fila.ingreso as string | null) ?? null
  const patron = fila.patron as { numero?: number; nombre?: string } | null
  return {
    id: String(fila.id),
    creado: String(fila.creado),
    estado: String(fila.estado ?? 'recibido'),
    whatsapp: (fila.whatsapp as string | null) ?? null,
    pais: (fila.pais as string | null) ?? null,
    ocupacion: (fila.ocupacion as string | null) ?? null,
    edad: (fila.edad as string | null) ?? null,
    ingreso,
    semaforo: semaforoPorIngreso(ingreso),
    patron: patron && typeof patron.numero === 'number' && patron.nombre
      ? { numero: patron.numero, nombre: patron.nombre }
      : null,
    resumen_equipo: (fila.resumen_equipo as string | null) ?? null,
    riesgo: Boolean(fila.riesgo),
    seguimiento: (fila.seguimiento as SeguimientoLead) ?? 'pendiente',
    notas: (fila.notas as string | null) ?? null,
    error: (fila.error as string | null) ?? null,
    ig_username: (fila.ig_username as string | null) ?? null,
    lead_id: (fila.lead_id as string | null) ?? null,
    lead: null,
    vinculo: null,
  }
}

function soloDigitos(v: string | null | undefined): string {
  return String(v ?? '').replace(/\D/g, '')
}

/**
 * Une cada respuesta con el lead del CRM que ya entró por ManyChat.
 *
 * Orden de confianza: vínculo manual (lead_id en Neon), usuario de Instagram
 * que viajó en el enlace del lead magnet, y por último el teléfono. El nombre
 * no se usa nunca: la gente lo escribe distinto en cada lado y juntaríamos
 * personas equivocadas.
 */
async function cruzarConLeads(clientId: string, leads: LeadResearch[]): Promise<LeadResearch[]> {
  const supabase = await createClient()

  const ids = [...new Set(leads.map((l) => l.lead_id).filter((v): v is string => !!v))]
  const igs = [...new Set(leads.map((l) => l.ig_username?.toLowerCase()).filter((v): v is string => !!v))]
  const telefonos = [...new Set(leads.flatMap((l) => {
    const d = soloDigitos(l.whatsapp)
    return d ? [d, `+${d}`] : []
  }))]

  type LeadMin = { id: string; full_name: string | null; ig_username: string | null; phone: string | null }
  const encontrados: LeadMin[] = []
  const consultas = [
    ids.length ? supabase.from('leads').select('id, full_name, ig_username, phone').eq('client_id', clientId).in('id', ids) : null,
    igs.length ? supabase.from('leads').select('id, full_name, ig_username, phone').eq('client_id', clientId).in('ig_username', igs) : null,
    telefonos.length ? supabase.from('leads').select('id, full_name, ig_username, phone').eq('client_id', clientId).in('phone', telefonos) : null,
  ]
  for (const q of consultas) {
    if (!q) continue
    const { data, error } = await q
    if (error) {
      console.warn('[lead-magnet] cruce con leads falló:', error.message)
      continue
    }
    encontrados.push(...((data ?? []) as LeadMin[]))
  }

  const porId = new Map(encontrados.map((l) => [l.id, l]))
  const porIg = new Map(encontrados.filter((l) => l.ig_username).map((l) => [l.ig_username!.toLowerCase(), l]))
  const porTelefono = new Map(encontrados.filter((l) => l.phone).map((l) => [soloDigitos(l.phone), l]))

  return leads.map((l) => {
    let lead: LeadMin | undefined
    let vinculo: LeadResearch['vinculo'] = null
    if (l.lead_id && porId.has(l.lead_id)) {
      lead = porId.get(l.lead_id)
      vinculo = 'manual'
    } else if (l.ig_username && porIg.has(l.ig_username.toLowerCase())) {
      lead = porIg.get(l.ig_username.toLowerCase())
      vinculo = 'instagram'
    } else if (soloDigitos(l.whatsapp) && porTelefono.has(soloDigitos(l.whatsapp))) {
      lead = porTelefono.get(soloDigitos(l.whatsapp))
      vinculo = 'telefono'
    }
    return lead
      ? { ...l, lead: { id: lead.id, full_name: lead.full_name, ig_username: lead.ig_username }, vinculo }
      : l
  })
}

export type ResultadoLista =
  | { configurado: false }
  | { configurado: true; leads: LeadResearch[] }

export async function getLeadsResearch(clientId: string): Promise<ResultadoLista> {
  await assertAgencia()
  if (!URL_BD) return { configurado: false }

  const filas = await sql().query(
    `SELECT ${COLUMNAS_LISTA} FROM respuestas ORDER BY creado DESC LIMIT 1000`
  )
  const leads = await cruzarConLeads(clientId, (filas as Record<string, unknown>[]).map(aLead))
  return { configurado: true, leads }
}

/**
 * Vínculo manual con un lead del CRM (o null para quitarlo). Se guarda en
 * Neon, junto a la respuesta, porque es un dato de esa respuesta y no del lead.
 */
export async function vincularLeadResearch(id: string, leadId: string | null): Promise<void> {
  await assertAgencia()
  if (!URL_BD) throw new Error('Falta configurar LEAD_MAGNET_DATABASE_URL')

  await sql().query(`UPDATE respuestas SET lead_id = $1 WHERE id = $2`, [leadId, id])
}

export async function getLeadResearchDetalle(id: string): Promise<LeadResearchDetalle | null> {
  await assertAgencia()
  if (!URL_BD) return null

  const filas = await sql().query(
    `SELECT ${COLUMNAS_LISTA}, plan, respuestas FROM respuestas WHERE id = $1`,
    [id]
  )
  const fila = (filas as Record<string, unknown>[])[0]
  if (!fila) return null

  return {
    ...aLead(fila),
    plan: (fila.plan as PlanLead | null) ?? null,
    respuestas: Array.isArray(fila.respuestas) ? (fila.respuestas as unknown[]) : [],
  }
}

export async function updateSeguimientoResearch(id: string, seguimiento: SeguimientoLead): Promise<void> {
  await assertAgencia()
  if (!URL_BD) throw new Error('Falta configurar LEAD_MAGNET_DATABASE_URL')
  if (!SEGUIMIENTOS.some((s) => s.value === seguimiento)) throw new Error('Valor de seguimiento inválido')

  await sql().query(`UPDATE respuestas SET seguimiento = $1 WHERE id = $2`, [seguimiento, id])
}

export async function updateNotasResearch(id: string, notas: string): Promise<void> {
  await assertAgencia()
  if (!URL_BD) throw new Error('Falta configurar LEAD_MAGNET_DATABASE_URL')

  // Mismo tope que el panel de la landing.
  await sql().query(`UPDATE respuestas SET notas = $1 WHERE id = $2`, [notas.slice(0, 2000), id])
}
