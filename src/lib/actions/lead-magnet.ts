'use server'

import { neon } from '@neondatabase/serverless'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { pickBalancedSetter } from '@/lib/manychat'
import {
  type AperturaResearch,
  type LeadResearch,
  type LeadResearchDetalle,
  type PlanLead,
  type SeguimientoLead,
  SEGUIMIENTOS,
  clienteTieneLeadMagnet,
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
 * Los datos de las personas son privados (ingreso, respuestas personales):
 * solo los ven los admins de la agencia y el equipo del propio cliente del
 * lead magnet. Los usuarios del portal de clientes no.
 *
 * Antes bastaba con ser `agency`: una setter de otro cliente podía llamar
 * estas acciones y leer todas las respuestas de la landing, porque la base
 * Neon no distingue clientes. Y `getLeadsResearch` aceptaba cualquier
 * `clientId`, así que las respuestas de Carol se podían dar de alta como
 * leads en otro cliente.
 *
 * `clientId` es el cliente que se pide; las acciones que solo reciben el id de
 * una respuesta lo omiten y se valida contra el cliente del propio usuario.
 */
async function assertAcceso(clientId?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')

  const { data: caller } = await supabase
    .from('users')
    .select('user_type, role, client_id')
    .eq('id', user.id)
    .single()

  if (!caller || caller.user_type !== 'agency') {
    throw new Error('Solo el equipo de la agencia puede ver esta información')
  }

  const esAdmin = caller.role === 'admin'
  if (!esAdmin && (!caller.client_id || (clientId && clientId !== caller.client_id))) {
    throw new Error('No tienes acceso a este cliente')
  }

  const objetivo = clientId ?? (esAdmin ? null : caller.client_id)
  if (!objetivo) return

  const { data: cliente } = await supabase
    .from('clients')
    .select('id, name')
    .eq('id', objetivo)
    .maybeSingle()
  if (!cliente || !clienteTieneLeadMagnet(cliente)) {
    throw new Error('Este cliente no tiene lead magnet')
  }
}

/**
 * Parte una lista para los `.in()`: PostgREST manda el filtro en la URL, y con
 * cientos de valores la URL pasa el límite y la consulta falla entera.
 */
function enLotes<T>(valores: T[], tamano = 200): T[][] {
  const lotes: T[][] = []
  for (let i = 0; i < valores.length; i += tamano) lotes.push(valores.slice(i, i + tamano))
  return lotes
}

/** Usuario de Instagram comparable: sin espacios, sin "@" inicial y en minúsculas. */
function normalizarIg(v: string | null | undefined): string {
  return String(v ?? '').trim().replace(/^@+/, '').toLowerCase()
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
  const igs = [...new Set(leads.map((l) => normalizarIg(l.ig_username)).filter(Boolean))]
  const telefonos = [...new Set(leads.flatMap((l) => {
    const d = soloDigitos(l.whatsapp)
    return d ? [d, `+${d}`] : []
  }))]

  const columnas = 'id, full_name, ig_username, phone'
  const encontrados: LeadMin[] = []
  const consultas = [
    ...enLotes(ids).map((lote) => supabase.from('leads').select(columnas).eq('client_id', clientId).in('id', lote)),
    // Con y sin "@": algunos leads quedaron guardados con el prefijo.
    ...enLotes(igs).map((lote) => supabase.from('leads').select(columnas).eq('client_id', clientId).in('ig_username', [...lote, ...lote.map((i) => `@${i}`)])),
    ...enLotes(telefonos).map((lote) => supabase.from('leads').select(columnas).eq('client_id', clientId).in('phone', lote)),
  ]
  for (const q of consultas) {
    const { data, error } = await q
    if (error) {
      console.warn('[lead-magnet] cruce con leads falló:', error.message)
      continue
    }
    encontrados.push(...((data ?? []) as LeadMin[]))
  }

  const porId = new Map(encontrados.map((l) => [l.id, l]))
  const porIg = new Map(encontrados.filter((l) => l.ig_username).map((l) => [normalizarIg(l.ig_username), l]))
  const porTelefono = new Map(encontrados.filter((l) => l.phone).map((l) => [soloDigitos(l.phone), l]))

  return leads.map((l) => {
    let lead: LeadMin | undefined
    let vinculo: LeadResearch['vinculo'] = null
    if (l.lead_id && porId.has(l.lead_id)) {
      lead = porId.get(l.lead_id)
      vinculo = 'manual'
    } else if (l.ig_username && porIg.has(normalizarIg(l.ig_username))) {
      lead = porIg.get(normalizarIg(l.ig_username))
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

type LeadMin = { id: string; full_name: string | null; ig_username: string | null; phone: string | null }

type CandidatoLead = {
  ig_username: string
  phone: string | null
  origen: 'lead_magnet' | 'lead_magnet_incompleto'
  /** Cuándo respondió o abrió el formulario en la landing (ISO, UTC). */
  creado: string
}

/**
 * Crea en el CRM los leads que faltan.
 *
 * ManyChat en plan Essential no puede avisar al CRM cuando alguien pide el
 * lead magnet (la "solicitud externa" es de Pro). Así que el CRM los da de
 * alta solo, a partir del usuario de Instagram que viajó en el enlace: si no
 * existe un lead de Carol con ese usuario, se crea en la primera etapa del
 * pipeline, con setter asignado igual que los leads de ManyChat.
 *
 * Tiene que ser idempotente, porque corre cada vez que alguien abre la
 * pestaña:
 * - Un lead que ya existe no se toca nunca: ni setter, ni etapa, ni
 *   `first_touch_at`. La comparación ignora mayúsculas y el "@" inicial, para
 *   que el mismo usuario escrito distinto en la landing no se duplique.
 * - `first_touch_at` sale de cuándo la persona respondió o abrió el
 *   formulario en la landing (lo más antiguo que haya para ese usuario), no
 *   de cuándo alguien abrió la pestaña. Así, si un lead llegara a recrearse,
 *   vuelve con la misma fecha en vez de parecer un contacto nuevo de hoy.
 * - Si no se puede comprobar qué leads existen, no se crea ninguno: crear a
 *   ciegas es justo lo que duplica.
 *
 * Queda una carrera: dos cargas simultáneas pueden crear el mismo lead dos
 * veces, porque `leads` no tiene índice único por usuario de Instagram.
 */
async function asegurarLeads(clientId: string, candidatos: CandidatoLead[]): Promise<void> {
  // Un candidato por usuario. Las respuestas completas van primero en la
  // lista, así que su origen y su teléfono ganan sobre una apertura a medias;
  // la fecha es la más antigua de todas.
  const porIg = new Map<string, CandidatoLead>()
  for (const c of candidatos) {
    const ig = normalizarIg(c.ig_username)
    if (!ig) continue
    const previo = porIg.get(ig)
    if (!previo) {
      porIg.set(ig, { ...c, ig_username: ig })
    } else {
      const valida = Number.isFinite(Date.parse(c.creado))
      if (valida && (!Number.isFinite(Date.parse(previo.creado)) || c.creado < previo.creado)) previo.creado = c.creado
      if (!previo.phone && c.phone) previo.phone = c.phone
    }
  }
  const igs = [...porIg.keys()]
  if (!igs.length) return

  const supabase = await createClient()
  const yaEstan = new Set<string>()
  for (const lote of enLotes(igs)) {
    const { data: existentes, error } = await supabase
      .from('leads')
      .select('ig_username')
      .eq('client_id', clientId)
      .in('ig_username', [...lote, ...lote.map((i) => `@${i}`)])
    if (error) {
      console.warn('[lead-magnet] no se pudo revisar leads existentes:', error.message)
      return
    }
    for (const l of existentes ?? []) yaEstan.add(normalizarIg(l.ig_username))
  }

  // Instagram guarda los usuarios en minúsculas y así llegan de ManyChat (en
  // producción no hay ningún lead con mayúsculas), por eso basta con buscar la
  // forma normalizada y la variante con "@".
  const faltan = igs.filter((ig) => !yaEstan.has(ig)).map((ig) => porIg.get(ig)!)
  if (!faltan.length) return

  const { data: cliente } = await supabase
    .from('clients')
    .select('pipeline_stages')
    .eq('id', clientId)
    .maybeSingle()
  const etapas = (cliente?.pipeline_stages ?? null) as { id: string }[] | null
  const primeraEtapa = etapas?.[0]?.id ?? 'nuevo_contacto'

  const admin = createAdminClient()
  for (const c of faltan) {
    const assignedTo = await pickBalancedSetter(admin, clientId).catch(() => null)
    const { error: insertError } = await supabase.from('leads').insert({
      client_id: clientId,
      ig_username: c.ig_username,
      phone: c.phone,
      stage: primeraEtapa,
      assigned_to: assignedTo,
      first_touch_at: Number.isFinite(Date.parse(c.creado)) ? c.creado : new Date().toISOString(),
      first_touch_type: c.origen,
    })
    // 23505 = ya hay un lead de este cliente con ese teléfono
    // (uq_leads_client_phone_e164): la persona ya está en el CRM con otro
    // usuario y el cruce por teléfono la une. No es un error.
    if (insertError && insertError.code !== '23505') {
      console.warn('[lead-magnet] no se pudo crear el lead', c.ig_username, insertError.message)
    }
  }
}

/** Es la tabla `aperturas` la que falta (la crea la landing en su primer uso). */
function tablaAusente(e: unknown): boolean {
  const code = (e as { code?: string })?.code
  const msg = String((e as { message?: string })?.message ?? '')
  return code === '42P01' || /relation .* does not exist/i.test(msg)
}

async function leerAperturas(): Promise<AperturaResearch[]> {
  let filas: Record<string, unknown>[]
  try {
    filas = (await sql().query(`
      SELECT id,
        to_char(creado AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS creado,
        to_char(actualizado AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS actualizado,
        ig_username, paso,
        respuestas->>0 AS primera_respuesta
      FROM aperturas
      WHERE respuesta_id IS NULL AND paso >= 1
      ORDER BY actualizado DESC
      LIMIT 300
    `)) as Record<string, unknown>[]
  } catch (e) {
    if (tablaAusente(e)) return []
    throw e
  }

  return filas.map((f) => ({
    id: String(f.id),
    creado: String(f.creado),
    actualizado: String(f.actualizado),
    ig_username: (f.ig_username as string | null) ?? null,
    paso: Number(f.paso) || 0,
    primera_respuesta: (f.primera_respuesta as string | null) ?? null,
    lead: null,
  }))
}

/**
 * Une cada apertura con su lead por usuario de Instagram. Va separado de la
 * lectura para no volver a consultar Neon después de dar de alta los leads:
 * antes la carga leía las aperturas dos veces.
 */
async function cruzarAperturas(clientId: string, aperturas: AperturaResearch[]): Promise<AperturaResearch[]> {
  const igs = [...new Set(aperturas.map((a) => normalizarIg(a.ig_username)).filter(Boolean))]
  if (!igs.length) return aperturas

  const supabase = await createClient()
  const encontrados: { id: string; full_name: string | null; ig_username: string | null }[] = []
  for (const lote of enLotes(igs)) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, full_name, ig_username')
      .eq('client_id', clientId)
      .in('ig_username', [...lote, ...lote.map((i) => `@${i}`)])
    if (error) {
      console.warn('[lead-magnet] cruce de aperturas falló:', error.message)
      continue
    }
    encontrados.push(...(data ?? []))
  }
  const porIg = new Map(encontrados.map((l) => [normalizarIg(l.ig_username), l]))
  return aperturas.map((a) => {
    const l = a.ig_username ? porIg.get(normalizarIg(a.ig_username)) : undefined
    return l ? { ...a, lead: { id: l.id, full_name: l.full_name, ig_username: l.ig_username } } : a
  })
}

export type ResultadoLista =
  | { configurado: false }
  | { configurado: true; leads: LeadResearch[]; aperturas: AperturaResearch[] }

export async function getLeadsResearch(clientId: string): Promise<ResultadoLista> {
  await assertAcceso(clientId)
  if (!URL_BD) return { configurado: false }

  const filas = await sql().query(
    `SELECT ${COLUMNAS_LISTA} FROM respuestas ORDER BY creado DESC LIMIT 1000`
  )
  const crudos = (filas as Record<string, unknown>[]).map(aLead)
  let aperturasCrudas: AperturaResearch[] = []
  try {
    aperturasCrudas = await leerAperturas()
  } catch (e) {
    console.warn('[lead-magnet] aperturas no disponibles:', (e as Error).message)
  }

  // Primero se dan de alta los leads que faltan, después se cruza: así la
  // fila ya sale unida en la misma carga.
  await asegurarLeads(clientId, [
    ...crudos.filter((l) => l.ig_username).map((l) => ({ ig_username: l.ig_username!, phone: l.whatsapp, origen: 'lead_magnet' as const, creado: l.creado })),
    ...aperturasCrudas.filter((a) => a.ig_username).map((a) => ({ ig_username: a.ig_username!, phone: null, origen: 'lead_magnet_incompleto' as const, creado: a.creado })),
  ])

  const [leads, aperturas] = await Promise.all([
    cruzarConLeads(clientId, crudos),
    cruzarAperturas(clientId, aperturasCrudas),
  ])
  return { configurado: true, leads, aperturas }
}

/**
 * Vínculo manual con un lead del CRM (o null para quitarlo). Se guarda en
 * Neon, junto a la respuesta, porque es un dato de esa respuesta y no del lead.
 */
export async function vincularLeadResearch(id: string, leadId: string | null): Promise<void> {
  await assertAcceso()
  if (!URL_BD) throw new Error('Falta configurar LEAD_MAGNET_DATABASE_URL')

  await sql().query(`UPDATE respuestas SET lead_id = $1 WHERE id = $2`, [leadId, id])
}

export async function getLeadResearchDetalle(id: string): Promise<LeadResearchDetalle | null> {
  await assertAcceso()
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
  await assertAcceso()
  if (!URL_BD) throw new Error('Falta configurar LEAD_MAGNET_DATABASE_URL')
  if (!SEGUIMIENTOS.some((s) => s.value === seguimiento)) throw new Error('Valor de seguimiento inválido')

  await sql().query(`UPDATE respuestas SET seguimiento = $1 WHERE id = $2`, [seguimiento, id])
}

export async function updateNotasResearch(id: string, notas: string): Promise<void> {
  await assertAcceso()
  if (!URL_BD) throw new Error('Falta configurar LEAD_MAGNET_DATABASE_URL')

  // Mismo tope que el panel de la landing.
  await sql().query(`UPDATE respuestas SET notas = $1 WHERE id = $2`, [notas.slice(0, 2000), id])
}
