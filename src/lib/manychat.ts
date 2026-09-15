import { NextResponse } from 'next/server'
import { exigirTokenManyChat } from '@/lib/api-auth'
import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export type Classification = 'chat_abierto' | 'conversacion_real' | 'lead_calificado' | 'disqualified'

const VALID_CLASSIFICATIONS: Classification[] = ['chat_abierto', 'conversacion_real', 'lead_calificado', 'disqualified']

// Qué clasificaciones anteriores puede "promover en el lugar" cada
// clasificación nueva — chat_abierto -> conversacion_real -> lead_calificado
// es una progresión, así que promover a una etapa tiene que poder
// encontrar la fila en CUALQUIER etapa previa, no solo en chat_abierto.
// Incluye la propia clasificación destino: si el nodo de ManyChat se
// dispara dos veces para la misma persona (reintento, flujo con loop, CTA
// tocado de nuevo), la segunda llamada tiene que encontrar y actualizar la
// fila que ya quedó en esa etapa — si no, no matchea nada y cae al INSERT,
// duplicando la interacción en vez de "promoverla en el lugar".
const PROMOTABLE_FROM: Record<Classification, Classification[]> = {
  chat_abierto: [],
  conversacion_real: ['chat_abierto', 'conversacion_real'],
  lead_calificado: ['chat_abierto', 'conversacion_real', 'lead_calificado'],
  disqualified: ['chat_abierto', 'conversacion_real', 'lead_calificado', 'disqualified'],
}

// Resolves the interaction's classification from an explicit field in the
// ManyChat payload (classification / event / stage), falling back to the
// legacy tag/qualified-flag heuristic, and defaulting to "chat abrió el CTA"
// when nothing says otherwise — matches ManyChat calling this webhook once
// on flow entry and again (with an explicit marker) once the prospect replies.
export function resolveClassification(payload: Record<string, unknown>): Classification {
  const explicit = (payload.classification || payload.event || payload.stage) as string | undefined
  if (explicit && VALID_CLASSIFICATIONS.includes(explicit as Classification)) {
    return explicit as Classification
  }

  const tags = (payload.tags as string[]) || []
  const customFields = (payload.custom_fields as Record<string, unknown>) || {}
  const isQualified =
    tags.includes('qualified') ||
    tags.includes('conversacion_real') ||
    customFields.qualified === true ||
    payload.qualified === true

  return isQualified ? 'conversacion_real' : 'chat_abierto'
}

// Campos que ya tienen un significado fijo en el payload — todo lo demás
// que llegue (sea porque se armó a mano campo por campo en el editor de
// ManyChat, o porque viene adentro de custom_fields) se guarda como parte
// de la ficha de calificación.
const RESERVED_PAYLOAD_KEYS = new Set([
  'ig_username', 'instagram_user_handle', 'username', 'instagram_username',
  'full_name', 'name', 'first_name', 'last_name',
  'email', 'phone', 'phone_number',
  'subscriber_id', 'id',
  'classification', 'event', 'stage', 'tags', 'custom_fields', 'qualified', 'pieceId',
  // Metadata que ManyChat manda en todo webhook de "Full Contact Data" del
  // suscriptor — no son respuestas del quiz/botonera, así que no deben
  // colarse en prequalification_data junto con nivel/zona/ocupación/etc.
  'key', 'page_id', 'user_refs', 'status', 'gender', 'locale', 'language', 'timezone',
  'profile_pic', 'live_chat_url', 'last_input_text', 'last_interaction',
  'ig_id', 'ig_last_interaction', 'ig_last_seen',
  'subscribed', 'optin_phone', 'optin_email', 'optin_whatsapp', 'whatsapp_phone', 'is_followup_enabled',
  // Lo que el propio webhook agrega al payload guardado en webhook_logs. El
  // reproceso vuelve a leer ese payload y no debe tomarlos por respuestas.
  'clasificacion', 'cuenta_manychat',
])

// ManyChat manda los custom fields de dos formas distintas según cómo se
// arme la solicitud: como objeto plano ({"nivel": "..."}) si se escriben a
// mano, o como el array [{name, value}, ...] que trae "Full Contact Data"
// de forma nativa. Se soportan ambas, más cualquier campo suelto que se
// haya agregado directo al cuerpo (fuera de "custom_fields").
function extractCustomFields(payload: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  const raw = payload.custom_fields
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (entry && typeof entry === 'object' && 'name' in entry) {
        const name = (entry as { name?: unknown }).name
        const value = (entry as { value?: unknown }).value
        if (typeof name === 'string' && value !== null && value !== undefined && value !== '') {
          result[name] = value
        }
      }
    }
  } else if (raw && typeof raw === 'object') {
    Object.assign(result, raw as Record<string, unknown>)
  }

  for (const [key, value] of Object.entries(payload)) {
    if (RESERVED_PAYLOAD_KEYS.has(key)) continue
    if (value === null || value === undefined || value === '') continue
    result[key] = value
  }

  return result
}

export interface InteractionParams {
  clientId: string
  contentId: string | null
  igUsername: string
  fullName: string | null
  subscriberId: string
  // ID de Instagram del suscriptor (ig_id en ManyChat). Es el identificador
  // estable de la persona; el @usuario cambia y el subscriber_id es de ManyChat.
  igUserId?: string | null
  keywordUsed: string | null
  classification: Classification
  customFields?: Record<string, unknown>
  /**
   * Cuándo ocurrió el chat. Vacío = ahora (webhook en vivo). El reproceso de
   * llamadas viejas pasa la fecha original del log: con now() todos esos
   * chats caerían en el día del reproceso e inflarían ese día.
   */
  momento?: string | null
}

// Records a ManyChat interaction. When the incoming event is anything other
// than "chat_abierto", first looks for a recent promotable row from the
// same person and promotes it in place — so a multi-call ManyChat flow
// (entry, quiz answers, reply) produces ONE interaction that upgrades over
// time, instead of separate rows that would double-count "chats abiertos".
// Returns the id of the interaction row that was written to, so the caller
// can link it back onto the lead (leads.interaction_id).
/**
 * Suma 1 a chats_nuevos de la pieza. Usa la función atómica de la migración
 * 064; si todavía no existe, cae al leer-y-escribir de antes.
 */
export async function incrementarChatsNuevos(supabase: AdminClient, contentId: string, clientId: string): Promise<void> {
  const { error } = await supabase.rpc('incrementar_chats_nuevos', { p_content_id: contentId, p_client_id: clientId })
  if (!error) return
  const funcionAusente = error.code === '42883' || error.code === 'PGRST202'
  if (!funcionAusente) {
    console.error('[ManyChat] incrementar_chats_nuevos falló:', error.message)
    return
  }
  const { data: metric } = await supabase
    .from('content_metrics')
    .select('id, chats_nuevos')
    .eq('content_id', contentId)
    .maybeSingle()
  if (metric) {
    await supabase
      .from('content_metrics')
      .update({ chats_nuevos: (metric.chats_nuevos || 0) + 1, updated_at: new Date().toISOString() })
      .eq('id', metric.id)
  } else {
    await supabase.from('content_metrics').insert({ content_id: contentId, client_id: clientId, chats_nuevos: 1 })
  }
}

export interface ResultadoUpsertInteraction {
  id: string
  /** true si se insertó una interacción nueva; false si se promovió una existente. */
  nueva: boolean
}

export async function upsertInteraction(supabase: AdminClient, params: InteractionParams): Promise<ResultadoUpsertInteraction> {
  const now = params.momento ?? new Date().toISOString()

  if (params.classification !== 'chat_abierto' && params.igUsername) {
    const since = new Date(new Date(now).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    let busqueda = supabase
      .from('interactions')
      .select('id, prequalification_data')
      .eq('client_id', params.clientId)
      .eq('ig_username', params.igUsername)
      .in('classification', PROMOTABLE_FROM[params.classification])
      .gte('bot_triggered_at', since)
    // Un chat reprocesado de agosto no puede promover una interacción de
    // septiembre: pisaría la clasificación y la fecha de respuesta de un chat
    // posterior.
    if (params.momento) busqueda = busqueda.lte('bot_triggered_at', now)
    const { data: existing } = await busqueda
      .order('bot_triggered_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing) {
      // Merge, don't replace — earlier steps in the ManyChat quiz (nivel,
      // zona) may have already landed custom fields on this row before this
      // later call (edad, ocupación) arrives.
      const mergedFields = {
        ...((existing.prequalification_data as Record<string, unknown>) || {}),
        ...(params.customFields || {}),
      }
      await supabase
        .from('interactions')
        .update({
          classification: params.classification,
          prospect_responded_at: now,
          qualified_at: (params.classification === 'conversacion_real' || params.classification === 'lead_calificado') ? now : null,
          prequalification_data: mergedFields,
          ...(params.igUserId ? { ig_user_id: params.igUserId } : {}),
          updated_at: now,
        })
        .eq('id', existing.id)
      return { id: existing.id, nueva: false }
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from('interactions')
    .insert({
      client_id: params.clientId,
      content_id: params.contentId,
      ig_username: params.igUsername,
      prospect_name: params.fullName,
      classification: params.classification,
      source: 'manychat',
      manychat_subscriber_id: params.subscriberId,
      ig_user_id: params.igUserId || null,
      keyword_used: params.keywordUsed,
      bot_triggered_at: now,
      prospect_responded_at: params.classification !== 'chat_abierto' ? now : null,
      qualified_at: (params.classification === 'conversacion_real' || params.classification === 'lead_calificado') ? now : null,
      prequalification_data: params.customFields || {},
      promoted_to_lead: true,
    })
    .select('id')
    .single()

  if (insertError || !inserted) throw insertError || new Error('Failed to insert interaction')
  return { id: inserted.id, nueva: true }
}

// Picks whichever active setter on the client's team is furthest below
// their target share right now (assigned count ÷ their lead_weight, lowest
// ratio wins) — self-balancing instead of a coin flip, so the split
// converges on each setter's configured share over time rather than
// drifting on a lucky streak. Equal weights (the default, lead_weight=1 for
// everyone) means an even 50/50, 1/3-1/3-1/3, etc. Admins can skew this per
// setter from the Equipo tab; weights are relative, not required to sum to
// 100 — adding/removing a setter just re-normalizes automatically. Ties are
// broken at random so it doesn't always favor whichever setter sorts
// first. Returns null if the client has no setter on the team.
export async function pickBalancedSetter(supabase: AdminClient, clientId: string): Promise<string | null> {
  const baseQuery = () => supabase
    .from('users')
    .select('id, lead_weight')
    .eq('user_type', 'agency')
    .eq('is_active', true)
    .eq('client_id', clientId)
    .eq('role', 'setter')

  let { data: setters, error: settersError } = await baseQuery()

  // lead_weight (supabase/025-setter-lead-weight.sql) might not be
  // migrated onto the live DB yet — fall back to an even split instead of
  // silently assigning no one. 42703 = undefined_column.
  if (settersError?.code === '42703') {
    const fallback = await supabase
      .from('users')
      .select('id')
      .eq('user_type', 'agency')
      .eq('is_active', true)
      .eq('client_id', clientId)
      .eq('role', 'setter')
    setters = fallback.data?.map((s) => ({ ...s, lead_weight: 1 })) ?? null
  }

  if (!setters || setters.length === 0) return null
  if (setters.length === 1) return setters[0].id

  const setterIds = setters.map((s) => s.id)
  const { data: assignedLeads } = await supabase
    .from('leads')
    .select('assigned_to')
    .eq('client_id', clientId)
    .in('assigned_to', setterIds)

  const counts = new Map<string, number>(setterIds.map((id) => [id, 0]))
  for (const row of assignedLeads || []) {
    if (row.assigned_to) counts.set(row.assigned_to, (counts.get(row.assigned_to) || 0) + 1)
  }

  let bestRatio = Infinity
  let candidates: string[] = []
  for (const s of setters) {
    const weight = s.lead_weight || 1
    const ratio = counts.get(s.id)! / weight
    if (ratio < bestRatio) {
      bestRatio = ratio
      candidates = [s.id]
    } else if (ratio === bestRatio) {
      candidates.push(s.id)
    }
  }
  return candidates[Math.floor(Math.random() * candidates.length)]
}

// ── Pieza, cliente y log ────────────────────────────────────────────────────

/**
 * Patrón ILIKE que solo coincide con el texto exacto (sin distinguir
 * mayúsculas). `_` y `%` son comodines de ILIKE y los códigos de pieza llevan
 * guiones bajos: sin escaparlos, R_05_08 también coincidía con "RX05X08".
 */
export function patronExacto(texto: string): string {
  return texto.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

/**
 * Un código que ManyChat mandó sin reemplazar la variable ("{keyword_trigger}"
 * literal, pasó el 13-08) no es un código: la persona igual abrió el chat,
 * pero no hay CTA que anotarle.
 */
export function esCodigoValido(codigo: string | null | undefined): codigo is string {
  return !!codigo && codigo.trim().length > 0 && !/[{}]/.test(codigo)
}

/**
 * La pieza que corresponde al código.
 *
 * El orden por created_at es provisorio: R_05_08 existe dos veces y sin orden
 * Postgres devolvía cualquiera de las dos en cada llamada, repartiendo los
 * chats al azar. Con el orden, al menos siempre gana la misma (la más antigua)
 * hasta que se resuelva el duplicado y se corra la 034.
 */
export async function buscarPiezaPorCodigo(
  supabase: AdminClient,
  codigo: string
): Promise<{ id: string; client_id: string } | null> {
  if (!esCodigoValido(codigo)) return null
  const { data, error } = await supabase
    .from('content_pieces')
    .select('id, client_id')
    .ilike('keyword_trigger', patronExacto(codigo.trim()))
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error(`[ManyChat] no se pudo buscar la pieza "${codigo}": ${error.message}`)
    return null
  }
  return data ? { id: data.id as string, client_id: data.client_id as string } : null
}

/** La cuenta de ManyChat: el segmento de https://app.manychat.com/<cuenta>/... */
export function cuentaManyChat(payload: Record<string, unknown>): string | null {
  const url = typeof payload.live_chat_url === 'string' ? payload.live_chat_url : ''
  const m = url.match(/manychat\.com\/([^/?#]+)\//i)
  return m ? m[1] : null
}

// Por instancia de la función: la cuenta de un cliente no cambia, y la
// deducción desde webhook_logs recorre JSON.
const clientePorCuentaCache = new Map<string, string>()

/**
 * El cliente dueño de una cuenta de ManyChat.
 *
 * Primero por clients.manychat_account_id (migración 076). Si la columna no
 * existe todavía (42703) o ningún cliente la tiene configurada, se deduce del
 * último webhook procesado de esa misma cuenta cuyo código sí tenía pieza: la
 * pieza dice de qué cliente es. Si nada coincide, devuelve null y el chat se
 * guarda para revisión como antes, sin adivinar.
 */
export async function clientePorCuentaManyChat(supabase: AdminClient, cuenta: string | null): Promise<string | null> {
  if (!cuenta) return null
  const enCache = clientePorCuentaCache.get(cuenta)
  if (enCache) return enCache

  const { data, error } = await supabase
    .from('clients')
    .select('id')
    .eq('manychat_account_id', cuenta)
    .maybeSingle()
  if (!error && data?.id) {
    clientePorCuentaCache.set(cuenta, data.id as string)
    return data.id as string
  }
  if (error && error.code !== '42703') {
    console.error(`[ManyChat] no se pudo leer la cuenta ${cuenta} en clients: ${error.message}`)
  }

  const { data: logs, error: errorLogs } = await supabase
    .from('webhook_logs')
    .select('event_type')
    .eq('source', 'manychat')
    .eq('processed', true)
    .is('error', null)
    .like('event_type', 'piece:%')
    .like('payload->>live_chat_url', `%manychat.com/${patronExacto(cuenta)}/%`)
    .order('received_at', { ascending: false })
    .limit(5)
  if (errorLogs) {
    console.error(`[ManyChat] no se pudo deducir el cliente de la cuenta ${cuenta}: ${errorLogs.message}`)
    return null
  }

  for (const log of logs ?? []) {
    const codigo = String(log.event_type).slice('piece:'.length)
    const pieza = await buscarPiezaPorCodigo(supabase, codigo)
    if (pieza) {
      clientePorCuentaCache.set(cuenta, pieza.client_id)
      return pieza.client_id
    }
  }
  return null
}

/**
 * Marca el log como procesado y, si la columna existe (migración 075), le
 * anota el lead. Sin la columna PostgREST responde PGRST204 (o 42703): se
 * reintenta sin ella para no dejar el log pendiente por un dato accesorio.
 */
export async function marcarLogProcesado(
  supabase: AdminClient,
  logId: string | null,
  cambios: { leadId: string | null; error?: string | null }
): Promise<void> {
  if (!logId) return
  const base: Record<string, unknown> = { processed: true }
  if (cambios.error !== undefined) base.error = cambios.error
  const { error } = await supabase
    .from('webhook_logs')
    .update(cambios.leadId ? { ...base, lead_id: cambios.leadId } : base)
    .eq('id', logId)
  if (!error) return
  if (cambios.leadId && (error.code === 'PGRST204' || error.code === '42703')) {
    const { error: reintento } = await supabase.from('webhook_logs').update(base).eq('id', logId)
    if (reintento) console.error(`[ManyChat] no se pudo marcar el log ${logId}: ${reintento.message}`)
    return
  }
  console.error(`[ManyChat] no se pudo marcar el log ${logId}: ${error.message}`)
}

/** Texto de error que marca un chat registrado sin pieza. */
export function errorCodigoSinPieza(codigo: string): string {
  return `Código sin pieza: "${codigo}"`
}

/** Texto de error de un chat que no se pudo asignar a ningún cliente. */
export function errorSinPieza(codigo: string): string {
  return `No content piece matched keyword_trigger="${codigo}"`
}

// ── Datos de contacto del payload ───────────────────────────────────────────

export interface ContactoManyChat {
  igUsername: string
  fullName: string | null
  email: string | null
  phone: string | null
  subscriberId: string
  igUserId: string | null
  customFields: Record<string, unknown>
}

/** ManyChat Full Contact Data usa distintos nombres de campo según la versión. */
export function extraerContacto(payload: Record<string, unknown>): ContactoManyChat {
  const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v))

  const igUsername = texto(
    payload.ig_username || payload.instagram_user_handle || payload.username || payload.instagram_username || ''
  ).replace(/^@/, '').trim()

  const fullName = (
    texto(payload.full_name) ||
    texto(payload.name) ||
    (payload.first_name ? `${texto(payload.first_name)} ${texto(payload.last_name)}`.trim() : '')
  ).trim() || null

  return {
    igUsername,
    fullName,
    email: (payload.email as string) || null,
    phone: (payload.phone as string) || (payload.phone_number as string) || null,
    subscriberId: texto(payload.subscriber_id || payload.id || ''),
    // ig_id es el ID de Instagram del suscriptor que ManyChat manda en
    // "Full Contact Data". Antes se descartaba (está en RESERVED_PAYLOAD_KEYS)
    // y la columna interactions.ig_user_id quedaba siempre vacía.
    igUserId: texto(payload.ig_id || payload.ig_user_id || '').trim() || null,
    // Whatever ManyChat's flow has collected so far (nivel, zona, edad,
    // ocupación, etc.) — passed through as-is into prequalification_data,
    // no fixed schema on this side so the flow can add fields without a
    // code change here.
    customFields: extractCustomFields(payload),
  }
}

// ── Núcleo: lead + interacción ──────────────────────────────────────────────

export interface DatosChat {
  clientId: string
  /** null cuando el código no tiene pieza: el chat cuenta igual, sin CTA. */
  contentId: string | null
  /** El código tal como llegó en la URL. */
  codigo: string
  contacto: ContactoManyChat
  classification: Classification
  /**
   * Fecha original del chat, solo para el reproceso de llamadas viejas.
   * Vacío = webhook en vivo: timestamps de ahora, reatribución del CTA y
   * reparto de setter como siempre.
   */
  momento?: string | null
}

export interface ResultadoChat {
  leadId: string
  leadNuevo: boolean
  interactionId: string
  interaccionNueva: boolean
}

/**
 * Registra un chat de ManyChat: crea o actualiza el lead, reparte setter si
 * corresponde, registra (o promueve) la interacción y suma chats nuevos a la
 * pieza. Lo usan el webhook por pieza y el reproceso de chats sin pieza.
 */
export async function registrarChat(supabase: AdminClient, d: DatosChat): Promise<ResultadoChat> {
  const { clientId, contentId, codigo, contacto, classification } = d
  const reproceso = !!d.momento
  const ahora = d.momento ?? new Date().toISOString()
  const keyword = esCodigoValido(codigo) ? codigo : null

  // Upsert lead
  const { data: existingLead, error: errorBusqueda } = await supabase
    .from('leads')
    .select('id, first_touch_content_id, assigned_to, interaction_id')
    .eq('client_id', clientId)
    .eq('ig_username', contacto.igUsername)
    // Sin índice único por usuario puede haber duplicados: maybeSingle a
    // secas fallaba con dos filas y el webhook creaba un tercero.
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (errorBusqueda) throw errorBusqueda

  let leadId: string

  if (existingLead) {
    leadId = existingLead.id as string
    // El reproceso no toca el lead: es un chat de hace semanas y no puede
    // quitarle el crédito a un CTA posterior ni moverle updated_at a hoy.
    if (!reproceso) {
      const updates: Record<string, unknown> = {
        updated_at: ahora,
      }
      if (contacto.fullName) updates.full_name = contacto.fullName
      if (contentId && existingLead.first_touch_content_id !== contentId) {
        // Revenue attribution (content-analytics.ts, live-metrics.ts) reads
        // first_touch_content_id alone — despite the name, it's meant as
        // "the CTA that gets credited," not literally the first message
        // ever. Whichever CTA the lead touches keeps re-attributing here
        // until they have an agenda booked; once agenda_records has a row
        // for this lead, that CTA is locked in for good — later touches
        // still count as interactions (and get logged below, for
        // visibility) but must never steal credit for a booking/close that
        // already happened.
        const { data: existingAgenda } = await supabase
          .from('agenda_records')
          .select('id')
          .eq('lead_id', leadId)
          .limit(1)
          .maybeSingle()

        if (!existingAgenda) {
          updates.first_touch_content_id = contentId
          updates.first_touch_at = ahora
          updates.first_touch_type = `manychat:${codigo}`
        } else {
          updates.conversion_touch_content_id = contentId
          updates.conversion_touch_at = ahora
          updates.conversion_touch_type = 'manychat_piece'
        }
      }
      await supabase.from('leads').update(updates).eq('id', leadId)
    }
  } else {
    const { data: newLead, error: insertError } = await supabase
      .from('leads')
      .insert({
        client_id: clientId,
        ig_username: contacto.igUsername || null,
        full_name: contacto.fullName,
        email: contacto.email,
        phone: contacto.phone,
        stage: 'nuevo_contacto',
        content_id: contentId,
        first_touch_content_id: contentId,
        first_touch_at: ahora,
        first_touch_type: `manychat:${codigo}`,
        // En el reproceso el lead nace el día del chat, no el día en que se
        // recuperó: si no, "leads nuevos" de hoy saldría inflado.
        ...(reproceso ? { created_at: ahora, updated_at: ahora } : {}),
      })
      .select('id')
      .single()

    if (insertError || !newLead) throw insertError || new Error('No se pudo crear el lead')
    leadId = newLead.id as string
  }

  // Auto-assign a setter the moment a lead reaches conversación real or
  // lead_calificado — load-balanced across whichever setters are on this
  // client's team (same weights either way), so it self-corrects to an
  // even split instead of relying on coin-flip luck. Never overwrites a
  // setter someone already assigned by hand. Chat abierto stays
  // unassigned — nobody's earned ownership of a lead that hasn't
  // responded yet.
  // The `.is('assigned_to', null)` on the write (not just the read above)
  // matters: ManyChat can fire two of this contact's webhook calls close
  // enough together that both pass the !existingLead?.assigned_to check
  // before either write lands — without it, the second call's UPDATE
  // silently steals the lead from whichever setter the first call gave it
  // to.
  // El reproceso no reparte: cargarle a un setter cientos de chats de agosto
  // de una vez no es trabajo real, es ruido en su cola.
  if (!reproceso && (classification === 'conversacion_real' || classification === 'lead_calificado') && !existingLead?.assigned_to) {
    const setterId = await pickBalancedSetter(supabase, clientId)
    if (setterId) {
      await supabase.from('leads').update({ assigned_to: setterId }).eq('id', leadId).is('assigned_to', null)
    }
  }

  const { id: interactionId, nueva: interaccionNueva } = await upsertInteraction(supabase, {
    clientId,
    contentId,
    igUsername: contacto.igUsername,
    fullName: contacto.fullName,
    subscriberId: contacto.subscriberId,
    igUserId: contacto.igUserId,
    keywordUsed: keyword,
    classification,
    customFields: contacto.customFields,
    momento: d.momento ?? null,
  })

  // Link the lead to its interaction so the CRM can show the
  // prequalification_data (nivel/zona/edad/ocupación/etc.) on the lead's
  // card — kept current on every call, not just the first. En el reproceso
  // solo si el lead no tenía ninguna: la más reciente es la que vale.
  if (!reproceso || !existingLead?.interaction_id) {
    await supabase.from('leads').update({ interaction_id: interactionId }).eq('id', leadId)
  }

  // Chats nuevos cuenta personas, no llamadas: solo suma cuando la
  // interacción es nueva. Una persona que pasa por chat-abierto, después
  // por conversación y después por lead-calificado promueve la misma fila
  // y cuenta una vez.
  if (contentId && interaccionNueva) {
    await incrementarChatsNuevos(supabase, contentId, clientId)
  }

  return { leadId, leadNuevo: !existingLead, interactionId, interaccionNueva }
}

// ── Shared handler for the per-piece webhook URLs ───────────────────────────
// Two ManyChat "External Request" nodes call the same logic with a different
// forced classification, so which node fires depends only on where it sits
// in the flow — no JSON body editing required on the ManyChat side:
//   /api/webhooks/manychat/{pieceId}                → conversacion_real (existing node, after the reply)
//   /api/webhooks/manychat/{pieceId}/chat-abierto    → chat_abierto (new node, at the CTA/trigger)

export async function handlePieceWebhook(
  request: Request,
  pieceId: string,
  forcedClassification?: Classification
): Promise<NextResponse> {
  const supabase = createAdminClient()

  // Con MANYCHAT_WEBHOOK_TOKEN configurado, solo entran las llamadas que
  // traen el token. Sin configurar, se deja pasar todo (como antes) para no
  // cortar los flujos mientras se actualizan las URL en ManyChat.
  const noAutorizado = exigirTokenManyChat(request)
  if (noAutorizado) return noAutorizado

  let webhookLogId: string | null = null

  try {
    const payload = (await request.json()) as Record<string, unknown>
    const contacto = extraerContacto(payload)

    if (!contacto.igUsername && !contacto.subscriberId) {
      return NextResponse.json({ error: 'Missing identifier' }, { status: 400 })
    }

    // Register interaction — classification is forced by which URL was
    // called, falling back to the payload/default resolution otherwise. Se
    // calcula antes del log para guardarla ahí: el log es lo único que
    // permite reprocesar la llamada después.
    const classification = forcedClassification || resolveClassification(payload)
    const cuenta = cuentaManyChat(payload)

    // Match content piece by keyword_trigger = pieceId
    const pieza = await buscarPiezaPorCodigo(supabase, pieceId)
    const contentId = pieza?.id ?? null

    // Sin pieza, el cliente sale de la cuenta de ManyChat. Antes el chat se
    // descartaba entero: 681 llamadas de Mane en agosto y septiembre.
    const clientId = pieza?.client_id ?? (await clientePorCuentaManyChat(supabase, cuenta))
    const payloadLog = { ...payload, pieceId, clasificacion: classification, cuenta_manychat: cuenta }

    if (!clientId) {
      await supabase.from('webhook_logs').insert({
        source: 'manychat',
        event_type: `piece:${pieceId}`,
        payload: payloadLog,
        processed: false,
        error: errorSinPieza(pieceId),
      })
      return NextResponse.json({
        received: true,
        warning: `No content piece with keyword_trigger="${pieceId}"`,
      })
    }

    // Log. Se guarda el id para marcar exactamente esta fila al terminar,
    // no "la última de esta pieza", que con llamadas simultáneas era otra.
    // Sin pieza el error queda escrito aunque el chat se registre: es la
    // alerta que lista la pestaña Contenido para crear la pieza que falta.
    const errorLog = pieza ? null : errorCodigoSinPieza(pieceId)
    const { data: logRow } = await supabase.from('webhook_logs').insert({
      source: 'manychat',
      event_type: `piece:${pieceId}`,
      payload: payloadLog,
      processed: false,
      error: errorLog,
    }).select('id').single()
    webhookLogId = logRow?.id ?? null

    let resultado: ResultadoChat
    try {
      resultado = await registrarChat(supabase, {
        clientId,
        contentId,
        codigo: pieceId,
        contacto,
        classification,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? 'Error desconocido'
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    await marcarLogProcesado(supabase, webhookLogId, { leadId: resultado.leadId })

    return NextResponse.json({
      received: true,
      piece_id: pieceId,
      content_id: contentId,
      client_id: clientId,
      lead_id: resultado.leadId,
      classification,
      is_new_lead: resultado.leadNuevo,
      ...(pieza ? {} : { warning: errorCodigoSinPieza(pieceId) }),
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
