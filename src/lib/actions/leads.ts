'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionProfile, getSessionUser } from '@/lib/supabase/session'
import { revalidatePath } from 'next/cache'
import type { LeadStage, Lead, ContentPiece } from '@/lib/types'
import { fetchAllRows, fetchAllRowsByCursor } from '@/lib/supabase/paginate'
import { pickBalancedSetter } from '@/lib/manychat'
import { CODIGO_ORGANICO, FIRST_TOUCH_ORGANICO, OPCION_ORGANICO } from '@/lib/origen-organico'
import { esDuplicado, leadPorInstagram } from '@/lib/lead-por-instagram'
import { normalizarInstagram } from '@/lib/services/calendly-event'
import { getInteractionsForCrm, type InteraccionCrm } from '@/lib/actions/interactions'
import { getAgencyUsers } from '@/lib/actions/team'

export async function getLeads(clientId?: string) {
  const supabase = await createClient()

  // Keyset (not OFFSET) pagination — this query alone was timing out in
  // production for clients with 10k+ leads. See fetchAllRowsByCursor.
  const rows = await fetchAllRowsByCursor<Lead>((cursor, limit) => {
    let query = supabase
      .from('leads')
      // `prequalification_data` salía de acá y nadie la leía: los tres
      // consumidores del join (getLeadsForViewer, lead-chat, setter-app) sólo
      // miran `classification`, y la ficha de calificación del drawer la saca
      // del array de interactions que se pide aparte. Era un blob JSONB por
      // cada uno de los ~9.900 leads del cliente, traído para descartarlo.
      .select('*, clients(name, ig_handle), users!leads_assigned_to_fkey(full_name), interactions(classification)')
      .order('id', { ascending: true })
      .limit(limit)

    if (clientId) query = query.eq('client_id', clientId)
    if (cursor) query = query.gt('id', cursor)
    return query
  })

  // Restore the "most recently updated first" order the CRM tab expects —
  // cheap in JS now that everything's already in memory.
  return rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export interface LeadPipelineRow {
  id: string
  client_id: string
  ig_username: string | null
  full_name: string | null
  stage: LeadStage
  assigned_to: string | null
  close_value: number | null
  days_to_close: number | null
  first_touch_type: string | null
  created_at: string
  clients: { name: string; ig_handle: string } | null
  users: { full_name: string } | null
}

/**
 * Los leads del pipeline de /leads, con las columnas exactas que ese tablero
 * declara en su interface (LeadWithRelations) y nada más.
 *
 * Antes esa página llamaba a getLeads() SIN clientId: todos los leads de la
 * base, con las 30 columnas y los tres joins —incluido el JSONB de
 * prequalification_data— para un tablero que usa diez campos y ni siquiera
 * mira el join de interactions. Es de las pocas consultas que además crece con
 * cada cliente nuevo, porque no filtra por ninguno.
 *
 * Con clientId el filtro va en la consulta: antes el selector de cliente del
 * tablero filtraba en el navegador, así que elegir un cliente chico igual
 * bajaba los ~8.400 leads de todos en 9 páginas.
 */
export async function getLeadsForPipeline(clientId?: string): Promise<LeadPipelineRow[]> {
  const supabase = await createClient()

  const rows = await fetchAllRowsByCursor<LeadPipelineRow & { id: string }>((cursor, limit) => {
    let query = supabase
      .from('leads')
      .select('id, client_id, ig_username, full_name, stage, assigned_to, close_value, days_to_close, first_touch_type, created_at, clients(name, ig_handle), users!leads_assigned_to_fkey(full_name)')
      .order('id', { ascending: true })
      .limit(limit)
    if (clientId) query = query.eq('client_id', clientId)
    if (cursor) query = query.gt('id', cursor)
    return query as unknown as PromiseLike<{ data: (LeadPipelineRow & { id: string })[] | null; error: { message: string } | null }>
  })

  return rows
}

// Cheap count for tab badges — a client with thousands of leads shouldn't
// have to pull every row (with its two joins) across a dozen paginated
// requests just to show a number next to the CRM tab.
export async function getLeadsCount(clientId: string): Promise<number> {
  const supabase = await createClient()
  const { count, error } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)

  if (error) throw error
  return count ?? 0
}

// Bare id/name for the "which lead is this call about" lookup — no joins,
// none of the CRM tab's full row, so sigue siendo barato incluso con miles de
// leads. Sin clientId trae los de todos los clientes, que es lo que necesita
// la página /calls: antes esa página llamaba a getLeads() y se traía las 30
// columnas y los tres joins de cada lead de la base para quedarse con estos
// tres campos.
export async function getLeadOptions(clientId?: string): Promise<{ id: string; full_name: string | null; ig_username: string | null }[]> {
  const supabase = await createClient()
  return fetchAllRowsByCursor<{ id: string; full_name: string | null; ig_username: string | null }>((cursor, limit) => {
    let query = supabase
      .from('leads')
      .select('id, full_name, ig_username')
      .order('id', { ascending: true })
      .limit(limit)
    if (clientId) query = query.eq('client_id', clientId)
    if (cursor) query = query.gt('id', cursor)
    return query
  })
}

// The full, richly-joined lead list the CRM tab actually renders — kept
// out of the client page's initial load (see clients/[id]/page.tsx) and
// fetched on demand once someone opens the CRM tab, since a client with
// thousands of leads made that the single slowest thing on every page
// view regardless of which tab was open. Carries the same setter scoping
// clients/[id]/page.tsx used to apply itself: a setter only sees
// lead_calificado leads assigned to them; every earlier stage (chat
// abierto, conversación real) stays visible to the whole team, same as
// before. Auth/role are re-derived from the session here, not trusted
// from the caller, since this now runs from a client component.
export async function getLeadsForViewer(clientId: string) {
  const viewer = await getSessionProfile()
  const isSetter = viewer?.role === 'setter'

  const leads = await getLeads(clientId)
  if (!isSetter) return leads
  return soloVisiblesParaSetter(leads, viewer?.id)
}

/**
 * Un setter no ve los leads calificados que son de otro setter. Las etapas
 * anteriores (chat abierto, conversación real) las ve todo el equipo. La
 * clasificación sale del join `interactions(classification)` por
 * leads.interaction_id, que solo se pide cuando quien mira es setter.
 */
function soloVisiblesParaSetter<T extends { assigned_to: string | null }>(leads: T[], viewerId: string | undefined): T[] {
  return leads.filter((lead) => {
    const classification = (lead as { interactions?: { classification?: string } | null }).interactions?.classification
    const isQualifiedForSomeoneElse = classification === 'lead_calificado' && lead.assigned_to && lead.assigned_to !== viewerId
    return !isQualifiedForSomeoneElse
  })
}

export interface CrmTabData {
  leads: Lead[]
  interactions: InteraccionCrm[]
  agencyUsers: Awaited<ReturnType<typeof getAgencyUsers>>
  contentPieces: ContentPiece[]
  /** undefined si no se pudo contar: la pestaña Tareas queda sin badge. */
  pendingTaskCount: number | undefined
}

/**
 * Todo lo que necesita la pestaña CRM, en UNA server action.
 *
 * CrmTabLazy lanzaba cinco actions en un Promise.all (leads, interactions,
 * usuarios, piezas y el contador de tareas). Desde el navegador Next despacha
 * las server actions de a una, así que ese Promise.all corría en fila, y cada
 * una repetía la validación de sesión y la consulta a `users`. Aquí la sesión
 * se lee una vez y las cinco cargas van en paralelo de verdad, en el servidor.
 *
 * Además cada carga pide solo lo que el CRM usa:
 * - leads: `*` sin los joins de clients y users, que nadie lee en la pestaña.
 *   El join de interactions(classification) solo va si mira un setter, que es
 *   quien necesita el filtro de calificados ajenos.
 * - interactions: las ocho columnas de getInteractionsForCrm, sin joins.
 * - piezas: sin los joins de clients y campaigns.
 *
 * Los leads son lo único imprescindible: si fallan, falla la pestaña y se
 * ofrece reintentar. Lo demás degrada con un valor por defecto, para que un
 * adorno no se lleve la pestaña entera.
 */
export async function getCrmTabData(clientId: string): Promise<CrmTabData> {
  const perfil = await getSessionProfile()
  if (!perfil) throw new Error('No hay sesión. Vuelve a iniciar sesión.')

  // Un miembro del equipo que no es admin solo trabaja su cliente. El proxy ya
  // lo confina por ruta, pero una server action se puede invocar con otro
  // clientId a mano.
  if (perfil.user_type === 'agency' && perfil.role !== 'admin' && perfil.client_id && perfil.client_id !== clientId) {
    throw new Error('Sin acceso a este cliente')
  }

  const isSetter = perfil.role === 'setter'
  const supabase = await createClient()

  const avisar = (nombre: string) => (err: unknown) => {
    console.error(`[getCrmTabData] ${nombre} falló para ${clientId}:`, err instanceof Error ? err.message : err)
  }

  const [leads, interactions, agencyUsers, contentPieces, pendingTaskCount] = await Promise.all([
    fetchAllRowsByCursor<Lead>((cursor, limit) => {
      let query = supabase
        .from('leads')
        .select(isSetter ? '*, interactions(classification)' : '*')
        .eq('client_id', clientId)
        .order('id', { ascending: true })
        .limit(limit)
      if (cursor) query = query.gt('id', cursor)
      return query as unknown as PromiseLike<{ data: Lead[] | null; error: { message: string } | null }>
    }),
    getInteractionsForCrm(clientId).catch((err) => { avisar('interactions')(err); return [] as InteraccionCrm[] }),
    getAgencyUsers(clientId).catch((err) => { avisar('agencyUsers')(err); return [] }),
    fetchAllRows<ContentPiece>((from, to) =>
      supabase
        .from('content_pieces')
        .select('*')
        .eq('client_id', clientId)
        .order('published_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .range(from, to) as unknown as PromiseLike<{ data: ContentPiece[] | null; error: { message: string } | null }>
    ).catch((err) => { avisar('contentPieces')(err); return [] as ContentPiece[] }),
    contarTareasPendientes(supabase, perfil, clientId).catch((err) => { avisar('pendingTaskCount')(err); return undefined }),
  ])

  // El orden de "lo último actualizado primero" que espera la pestaña; barato
  // en JS con todo ya en memoria.
  leads.sort((a, b) => b.updated_at.localeCompare(a.updated_at))

  return {
    leads: isSetter ? soloVisiblesParaSetter(leads, perfil.id) : leads,
    interactions,
    agencyUsers,
    contentPieces,
    pendingTaskCount,
  }
}

/**
 * El badge de la sub-pestaña Tareas. Misma regla que getPendingTaskCount en
 * tasks.ts (el admin ve el total del cliente; cada miembro, solo lo suyo), pero
 * con el perfil ya leído: esa función vuelve a validar la sesión y a consultar
 * `users` por su cuenta. Si cambia la regla allá, hay que cambiarla aquí.
 */
async function contarTareasPendientes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  perfil: { id: string; user_type: string; role: string; client_id: string | null },
  clientId: string
): Promise<number> {
  if (perfil.user_type !== 'agency') return 0
  const esAdmin = perfil.role === 'admin'
  if (!esAdmin && perfil.client_id !== clientId) return 0

  let query = supabase
    .from('team_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .neq('status', 'hecha')
  if (!esAdmin) query = query.eq('assigned_to', perfil.id)

  const { count, error } = await query
  if (error) return 0
  return count ?? 0
}

export async function updateLeadStageAction(id: string, stage: string, agendaDate?: string): Promise<{ agendaError: string | null }> {
  const supabase = await createClient()

  const authUser = await getSessionUser()

  // Needed to tell a real advance from a re-marked "still here" touch —
  // fetched before the update overwrites it.
  const { data: existing } = await supabase.from('leads').select('stage').eq('id', id).maybeSingle()
  const previousStage = existing?.stage as LeadStage | undefined

  const updates: Record<string, unknown> = {
    stage,
    updated_at: new Date().toISOString(),
    next_follow_up_date: null,
    follow_up_count: 0,
  }

  const isAgendaStage = stage === 'agendado' || stage === 'agenda_set'
  if (isAgendaStage) updates.agenda_at = new Date().toISOString()
  if (stage === 'cliente' || stage === 'closed_won' || stage === 'cierre') updates.closed_at = new Date().toISOString()

  const { data: lead, error } = await supabase
    .from('leads')
    .update(updates)
    .eq('id', id)
    .select('id, client_id, full_name, ig_username, content_id, first_touch_at, first_touch_type, lead_avatar')
    .single()
  if (error) throw error

  // Setter activity log for the standards/goals system — 'contacto' when
  // the stage genuinely moved forward (or sideways), 'seguimiento' when
  // the same stage was re-marked (re-engaging a lead that hasn't
  // progressed). Decided here, from the actual before/after stage, so it
  // can't be misreported by whichever UI called this. Best-effort: a
  // logging failure never blocks the real stage change.
  if (authUser && lead) {
    try {
      await supabase.from('lead_activity_logs').insert({
        lead_id: id,
        user_id: authUser.id,
        client_id: lead.client_id,
        action_type: previousStage === stage ? 'seguimiento' : 'contacto',
        stage_at_time: stage,
      })
    } catch (err) {
      console.error('[updateLeadStageAction] activity log failed:', err)
    }
  }

  // No Calendly (or not yet configured) still needs the booking to show up
  // in Agendas and roll into the funnel — create the linked record once,
  // pre-filled with what we already know, so only the call outcome is left
  // to fill in manually. fecha_agenda is the date the CALL is scheduled
  // for, not today — the caller must supply it (asked at the moment the
  // stage changes) so "calls due on day X" stays accurate.
  // The stage change itself already committed above — a failure here is
  // reported back, not thrown, so it can't silently swallow the fact that
  // the lead's pipeline stage did change.
  let agendaError: string | null = null
  if (isAgendaStage && lead) {
    try {
      await ensureAgendaRecordForLead(supabase, lead, agendaDate || new Date().toISOString().split('T')[0])
    } catch (err) {
      agendaError = err instanceof Error ? err.message : 'No se pudo crear el registro en Agendas'
    }
  }

  revalidatePath('/leads')
  revalidatePath('/dashboard')
  return { agendaError }
}

/**
 * Todos los CTAs que tocó un lead, en el orden en que los tocó.
 *
 * Las interacciones se enlazan al lead por ig_username dentro del mismo
 * cliente (es el mismo criterio que usa la pestaña CRM para armar la ficha de
 * calificación), y cada una apunta a la pieza de contenido cuyo
 * keyword_trigger es el CTA visible ("H_18_08" y similares).
 *
 * Se compara en minúsculas porque el usuario de Instagram llega con distinta
 * capitalización según por dónde entró.
 */
async function ctasDelLead(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientId: string,
  igUsername: string | null
): Promise<string | null> {
  if (!igUsername) return null

  const { data: interacciones } = await supabase
    .from('interactions')
    .select('content_id, bot_triggered_at')
    .eq('client_id', clientId)
    .ilike('ig_username', igUsername)
    .order('bot_triggered_at', { ascending: true })

  const ids = [...new Set((interacciones ?? []).map((i) => i.content_id).filter((id): id is string => !!id))]
  if (ids.length === 0) return null

  const { data: piezas } = await supabase
    .from('content_pieces')
    .select('id, keyword_trigger')
    .in('id', ids)

  const keywordPorPieza = new Map((piezas ?? []).map((p) => [p.id as string, p.keyword_trigger as string | null]))

  const vistos = new Set<string>()
  const ctas: string[] = []
  for (const i of interacciones ?? []) {
    const kw = i.content_id ? keywordPorPieza.get(i.content_id) : null
    if (kw && !vistos.has(kw)) {
      vistos.add(kw)
      ctas.push(kw)
    }
  }

  return ctas.length > 0 ? ctas.join(' · ') : null
}

async function ensureAgendaRecordForLead(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lead: { id: string; client_id: string; full_name: string | null; ig_username: string | null; content_id: string | null; first_touch_at: string | null; first_touch_type: string | null; lead_avatar: string | null },
  agendaDate: string
) {
  // limit(1) y no maybeSingle(): un lead que reagendó tiene varias agendas, y
  // maybeSingle() fallaba con "multiple rows" al volver a moverlo de etapa.
  const { data: existing, error: existingError } = await supabase
    .from('agenda_records')
    .select('id')
    .eq('lead_id', lead.id)
    .limit(1)
  if (existingError) {
    console.error('[ensureAgendaRecordForLead] lookup failed:', existingError.message)
    throw existingError
  }
  if (existing && existing.length > 0) return

  let keyword: string | null = null
  if (lead.content_id) {
    const { data: cp } = await supabase
      .from('content_pieces')
      .select('keyword_trigger')
      .eq('id', lead.content_id)
      .maybeSingle()
    keyword = cp?.keyword_trigger || null
  }
  // Fallback: piece-based ManyChat webhooks stamp first_touch_type as
  // "manychat:{pieceId}" — pull the keyword out of that if content_id
  // itself never resolved (older leads, or the lookup above came up empty).
  if (!keyword && lead.first_touch_type) {
    keyword = lead.first_touch_type === FIRST_TOUCH_ORGANICO
      ? CODIGO_ORGANICO
      : lead.first_touch_type.match(/^manychat:(.+)$/)?.[1] || null
  }

  const { error: insertError } = await supabase.from('agenda_records').insert({
    client_id: lead.client_id,
    lead_id: lead.id,
    nombre_lead: lead.full_name,
    avatar: lead.lead_avatar,
    // The day the lead's stage was changed to "Agendado" — today, from the
    // CRM's perspective — distinct from fecha_agenda (the call date).
    fecha_agendado: new Date().toISOString().split('T')[0],
    fecha_agenda: agendaDate,
    fecha_1er_contacto: lead.first_touch_at ? lead.first_touch_at.split('T')[0] : null,
    primer_cta: keyword,
    // The visible "CTA" column in Agendas reads de_donde_vino, not primer_cta
    de_donde_vino: keyword,
    // Estos dos quedaban siempre vacíos y había que llenarlos a mano, aunque
    // el dato ya existía: el Instagram está en el lead y los CTAs salen de sus
    // interacciones. Son columnas de texto editable, así que quien quiera
    // puede corregirlas después — esto sólo evita partir de cero.
    link_perfil: lead.ig_username ? `https://instagram.com/${lead.ig_username.replace(/^@/, '')}` : null,
    todos_los_ctas: await ctasDelLead(supabase, lead.client_id, lead.ig_username),
    estado: 'Pendiente',
  })
  if (insertError) {
    console.error('[ensureAgendaRecordForLead] insert failed:', insertError.message, insertError.details)
    throw insertError
  }
}

export async function updateLeadAvatarAction(id: string, avatar: string | null) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('leads')
    .update({
      lead_avatar: avatar,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw error
  revalidatePath('/leads')
}

export async function addLeadEventAction(id: string, event: string) {
  const supabase = await createClient()

  const { data: lead } = await supabase
    .from('leads')
    .select('events')
    .eq('id', id)
    .single()

  const currentEvents: string[] = lead?.events || []
  if (currentEvents.includes(event)) return

  const { error } = await supabase
    .from('leads')
    .update({
      events: [...currentEvents, event],
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw error
  revalidatePath('/leads')
}

export async function removeLeadEventAction(id: string, event: string) {
  const supabase = await createClient()

  const { data: lead } = await supabase
    .from('leads')
    .select('events')
    .eq('id', id)
    .single()

  const currentEvents: string[] = lead?.events || []

  const { error } = await supabase
    .from('leads')
    .update({
      events: currentEvents.filter((e) => e !== event),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw error
  revalidatePath('/leads')
}

export async function updateLeadAction(id: string, formData: FormData) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('leads')
    .update({
      full_name: (formData.get('full_name') as string) || null,
      phone: (formData.get('phone') as string) || null,
      email: (formData.get('email') as string) || null,
      assigned_to: (formData.get('assigned_to') as string) || null,
      lead_avatar: (formData.get('lead_avatar') as string) || null,
      content_id: (formData.get('content_id') as string) || null,
      notes: (formData.get('notes') as string) || null,
      close_value: formData.get('close_value')
        ? parseFloat(formData.get('close_value') as string)
        : null,
      lost_reason: (formData.get('lost_reason') as string) || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw error
  revalidatePath('/leads')
}

/**
 * El mensaje para quien intenta crear un lead que ya existe, con el nombre de
 * la setter para que sepa a quién preguntarle.
 */
async function mensajeLeadRepetido(clientId: string, instagram: string | null): Promise<string | null> {
  const existente = await leadPorInstagram(createAdminClient(), clientId, instagram)
  if (!existente) return null
  let dueno = 'nadie'
  if (existente.assigned_to) {
    const { data } = await createAdminClient()
      .from('users')
      .select('full_name')
      .eq('id', existente.assigned_to)
      .maybeSingle()
    dueno = (data?.full_name as string | null) ?? 'otra persona'
  }
  const ig = normalizarInstagram(instagram)
  return `Ya existe un lead con @${ig} (asignado a ${dueno}). Búscalo en la tabla en vez de crear otro.`
}

// Devuelve el error en vez de lanzarlo: en producción Next oculta el mensaje
// de un throw en una server action, y "ya existe" es algo que la setter tiene
// que leer.
export async function createLeadAction(formData: FormData): Promise<{ error?: string }> {
  const supabase = await createClient()
  const clientId = formData.get('client_id') as string
  const instagram = normalizarInstagram(formData.get('ig_username') as string | null)

  const repetido = await mensajeLeadRepetido(clientId, instagram)
  if (repetido) return { error: repetido }

  // Every lead needs an owner — same balanced pick the ManyChat webhooks
  // use, so a lead added by hand doesn't sit unassigned just because
  // nobody checked a box. Falls back to null only if the client genuinely
  // has no active setter on the team.
  // El origen es obligatorio: una pieza de contenido o "DM directo". Sin esto
  // la setter lo dejaba vacío y la agenda salía "Sin origen" en el panel de
  // marketing (ver src/lib/origen-organico.ts).
  const cta = (formData.get('content_id') as string | null) || ''
  if (!cta) return { error: 'Elige de dónde vino el lead: una pieza de contenido o DM directo.' }
  const organico = cta === OPCION_ORGANICO

  const assignedTo = (formData.get('assigned_to') as string) || await pickBalancedSetter(createAdminClient(), clientId)

  const { error } = await supabase.from('leads').insert({
    client_id: clientId,
    ig_username: instagram,
    full_name: (formData.get('full_name') as string) || null,
    phone: (formData.get('phone') as string) || null,
    email: (formData.get('email') as string) || null,
    stage: (formData.get('stage') as LeadStage) || 'nuevo_contacto',
    content_id: organico ? null : cta,
    first_touch_type: organico ? FIRST_TOUCH_ORGANICO : null,
    lead_avatar: (formData.get('lead_avatar') as string) || null,
    assigned_to: assignedTo,
    close_value: formData.get('close_value')
      ? parseFloat(formData.get('close_value') as string)
      : null,
  })

  if (error) {
    if (esDuplicado(error)) {
      return { error: (await mensajeLeadRepetido(clientId, instagram)) ?? 'Ya existe un lead con ese teléfono o Instagram.' }
    }
    throw error
  }
  revalidatePath('/leads')
  revalidatePath(`/clients/${clientId}`)
  return {}
}

export async function updateLeadFieldsAction(id: string, fields: {
  full_name?: string | null
  ig_username?: string | null
  phone?: string | null
  email?: string | null
  lead_avatar?: string | null
  assigned_to?: string | null
  content_id?: string | null
  // Revenue-attribution FK (content-analytics.ts, live-metrics.ts) — set once
  // by the ManyChat webhook at lead creation and frozen from then on by
  // design (first-touch attribution). Exposed here so a wrong first touch
  // (e.g. a content piece that had the wrong ManyChat code tagged at the
  // time this lead came in) can be corrected without touching that history.
  first_touch_content_id?: string | null
  notes?: string | null
}) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('leads')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) {
    if (esDuplicado(error)) throw new Error('Ese Instagram o teléfono ya es de otro lead de este cliente.')
    throw error
  }
}

/**
 * Marca como DM directo un lead que no tiene origen. Solo toca leads con
 * first_touch_type vacío: el de ManyChat o el del agente es la atribución
 * de primer contacto y no se reemplaza desde la ficha.
 */
export async function marcarLeadOrganicoAction(id: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('leads')
    .update({ content_id: null, first_touch_type: FIRST_TOUCH_ORGANICO, updated_at: new Date().toISOString() })
    .eq('id', id)
    .is('first_touch_type', null)
  if (error) throw error
}

export async function deleteLeadAction(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('leads').delete().eq('id', id)
  if (error) throw error
}

export async function assignLeadContentAction(leadId: string, contentId: string | null) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('leads')
    .update({
      content_id: contentId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', leadId)

  if (error) throw error
  revalidatePath('/leads')
}

// "Hice seguimiento" en la pestaña Seguimientos, cuando el setter confirma
// que el lead sigue en la misma etapa (la conversación no avanzó todavía).
// A diferencia de updateLeadStageAction, la etapa no se toca — solo se saca
// al lead de la cola de "para hacer ahora" hasta mañana. follow_up_count no
// se resetea: es el historial de cuántas veces se lo reintentó vía
// "Perdido", y un touch exitoso no debería borrar ese historial. Igual que
// un re-marcado de la misma etapa desde el Kanban, esto loguea
// action_type 'seguimiento' para que cuente en "Seguimientos por etapa" del
// progreso del setter.
export async function markFollowUpDoneAction(id: string) {
  const supabase = await createClient()
  const authUser = await getSessionUser()

  const { data: lead, error: lookupError } = await supabase
    .from('leads')
    .select('client_id, stage')
    .eq('id', id)
    .single()
  if (lookupError) throw lookupError

  const { error } = await supabase
    .from('leads')
    .update({
      next_follow_up_date: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error

  if (authUser && lead) {
    try {
      await supabase.from('lead_activity_logs').insert({
        lead_id: id,
        user_id: authUser.id,
        client_id: lead.client_id,
        action_type: 'seguimiento',
        stage_at_time: lead.stage,
      })
    } catch (err) {
      console.error('[markFollowUpDoneAction] activity log failed:', err)
    }
  }

  revalidatePath('/leads')
  revalidatePath('/dashboard')
}

export async function snoozeLeadAction(id: string) {
  const supabase = await createClient()
  const authUser = await getSessionUser()

  // Buscamos el lead para ver su contador actual
  const { data: lead, error: lookupError } = await supabase
    .from('leads')
    .select('client_id, stage, follow_up_count')
    .eq('id', id)
    .single()

  if (lookupError) throw lookupError

  const currentCount = lead?.follow_up_count || 0
  const nextCount = currentCount + 1
  let stageAtTime = lead?.stage

  if (nextCount > 2) {
    // Ya intentó 2 veces, a la tercera muere (3er click en perdido)
    // O si el máximo es 2, después de 2 intentos ya pasa a lost
    stageAtTime = 'no_calificado'
    const { error } = await supabase
      .from('leads')
      .update({
        stage: 'no_calificado',
        updated_at: new Date().toISOString(),
        next_follow_up_date: null,
      })
      .eq('id', id)
    if (error) throw error
  } else {
    // Reprogramar para 24h si es el 1er intento, o 48h si es el 2do
    const waitHours = nextCount === 1 ? 24 : 48
    const nextDate = new Date()
    nextDate.setHours(nextDate.getHours() + waitHours)

    const { error } = await supabase
      .from('leads')
      .update({
        follow_up_count: nextCount,
        next_follow_up_date: nextDate.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) throw error
  }

  // "Perdido" sí cuenta como actividad del setter (leadsTouched: intentó
  // contactar antes de dar de baja al lead) pero NO debe sumar a
  // "Seguimientos por etapa" — esa métrica solo mira filas 'seguimiento'
  // (setter-app.ts). action_type solo admite 'contacto'/'seguimiento'
  // (CHECK constraint en 028-setter-standards.sql), así que 'contacto' es
  // el único valor que logra ese efecto sin abrir un tercer tipo en la BD.
  if (authUser && lead) {
    try {
      await supabase.from('lead_activity_logs').insert({
        lead_id: id,
        user_id: authUser.id,
        client_id: lead.client_id,
        action_type: 'contacto',
        stage_at_time: stageAtTime,
      })
    } catch (err) {
      console.error('[snoozeLeadAction] activity log failed:', err)
    }
  }

  revalidatePath('/leads')
  revalidatePath('/dashboard')
}

/** Un lead reducido a lo mínimo para mostrarlo en un selector. */
export interface LeadBusqueda {
  id: string
  full_name: string | null
  ig_username: string | null
}

/**
 * Busca leads de un cliente por nombre o usuario de Instagram.
 *
 * Existe para el selector de la agenda, donde el setter asocia a mano el lead
 * que el cruce automatico no encontro. No se reusa getLeadOptions porque esa
 * trae TODOS los leads del cliente: con los ~10 mil de un cliente grande, un
 * desplegable asi es inusable y manda megas al navegador en cada apertura.
 *
 * Se acota a 20 resultados: si el setter no encontro lo que buscaba entre 20,
 * el problema es la busqueda y no la cantidad de resultados.
 */
export async function buscarLeads(clientId: string, texto: string): Promise<LeadBusqueda[]> {
  const q = texto.trim()
  if (q.length < 2) return []

  const supabase = await createClient()
  // El % se escapa porque en ilike es un comodin: sin esto, escribir "%" en la
  // caja de busqueda devolveria leads al azar en vez de nada.
  const patron = `%${q.replace(/[%_]/g, '\$&')}%`

  const { data, error } = await supabase
    .from('leads')
    .select('id, full_name, ig_username')
    .eq('client_id', clientId)
    .or(`full_name.ilike.${patron},ig_username.ilike.${patron}`)
    .limit(20)

  if (error) throw error
  return data ?? []
}

/** Un lead por id, para mostrar cual esta asociado hoy a una agenda. */
export async function getLeadBasico(leadId: string): Promise<LeadBusqueda | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('leads')
    .select('id, full_name, ig_username')
    .eq('id', leadId)
    .maybeSingle()

  if (error) throw error
  return data
}

/** Una persona encontrada por el buscador global de leads. */
export interface PersonaEncontrada {
  leadId: string
  clientId: string
  clientName: string | null
  nombre: string | null
  igUsername: string | null
  stage: string | null
  /** instagram | nombre | correo | telefono | agenda_nombre | agenda_correo */
  coincidencia: string
}

const PRIORIDAD_COINCIDENCIA = ['instagram', 'nombre', 'correo', 'telefono', 'agenda_nombre', 'agenda_correo']

/**
 * Busca un lead por nombre, @IG, correo o teléfono, para abrir su historial.
 *
 * No reemplaza a buscarLeads: esa sirve al selector de la agenda, acotada a un
 * cliente y con otra forma de resultado. Esta es la caja de búsqueda global, y
 * busca también en las agendas porque el correo y el teléfono casi nunca están
 * en leads: llegan con la reserva.
 *
 * El alcance se decide aquí con la sesión, no con lo que mande el navegador:
 * un admin busca en todos los clientes, el resto solo en el suyo, un setter no
 * ve el lead calificado de otro setter, y el portal de clientes no busca nada.
 *
 * Usa la función buscar_personas (migración 075). Si todavía no se corrió cae a
 * dos consultas directas, más lentas pero equivalentes.
 */
export async function buscarPersonas(texto: string): Promise<PersonaEncontrada[]> {
  const q = String(texto ?? '').trim().slice(0, 100)
  if (q.length < 2) return []

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data: viewer } = await supabase
    .from('users')
    .select('role, user_type, client_id')
    .eq('id', user.id)
    .single()
  if (!viewer || viewer.user_type !== 'agency') return []

  const esAdmin = viewer.role === 'admin'
  if (!esAdmin && !viewer.client_id) return []
  const clientId: string | null = esAdmin ? null : viewer.client_id

  let personas: PersonaEncontrada[]
  const { data, error } = await supabase.rpc('buscar_personas', { p_texto: q, p_client_id: clientId })
  if (!error) {
    personas = ((data ?? []) as Record<string, unknown>[]).map((f) => ({
      leadId: String(f.lead_id),
      clientId: String(f.client_id),
      clientName: (f.client_name as string | null) ?? null,
      nombre: (f.nombre as string | null) ?? null,
      igUsername: (f.ig_username as string | null) ?? null,
      stage: (f.stage as string | null) ?? null,
      coincidencia: String(f.coincidencia ?? 'nombre'),
    }))
  } else if (error.code === 'PGRST202' || error.code === '42883') {
    personas = await buscarPersonasSinFuncion(supabase, q, clientId)
  } else {
    console.error('[buscarPersonas] buscar_personas falló:', error.code, error.message)
    throw new Error('No se pudo buscar. Intenta de nuevo.')
  }

  if (viewer.role === 'setter' && personas.length > 0) {
    const { data: filas } = await supabase
      .from('leads')
      .select('id, assigned_to, interactions(classification)')
      .in('id', personas.map((p) => p.leadId))
    const ocultos = new Set(
      (filas ?? [])
        .filter((l) => {
          const classification = (l as { interactions?: { classification?: string } | null }).interactions?.classification
          return classification === 'lead_calificado' && l.assigned_to && l.assigned_to !== user.id
        })
        .map((l) => String(l.id))
    )
    personas = personas.filter((p) => !ocultos.has(p.leadId))
  }

  return personas
}

/** La misma búsqueda que buscar_personas, para cuando la migración 075 no se corrió. */
async function buscarPersonasSinFuncion(
  supabase: Awaited<ReturnType<typeof createClient>>,
  q: string,
  clientId: string | null
): Promise<PersonaEncontrada[]> {
  // % y _ son comodines de ILIKE; el valor va entre comillas dobles para que
  // una coma o un paréntesis no rompan la sintaxis de .or() de PostgREST.
  const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const citar = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  const patron = citar(like(q))
  const patronIg = citar(like(q.replace(/^@/, '')))
  const digitos = q.replace(/\D/g, '')

  const filtrosLead = [`ig_username.ilike.${patronIg}`, `full_name.ilike.${patron}`, `email.ilike.${patron}`]
  if (digitos.length >= 6) filtrosLead.push(`phone_e164.ilike.${citar(`%${digitos}%`)}`)

  let consultaLeads = supabase
    .from('leads')
    .select('id, client_id, full_name, ig_username, email, phone_e164, stage, updated_at')
    .or(filtrosLead.join(','))
    .order('updated_at', { ascending: false })
    .limit(30)
  if (clientId) consultaLeads = consultaLeads.eq('client_id', clientId)

  let consultaAgendas = supabase
    .from('agenda_records')
    .select('lead_id, email_lead')
    .not('lead_id', 'is', null)
    .or(`nombre_lead.ilike.${patron},email_lead.ilike.${patron}`)
    .limit(30)
  if (clientId) consultaAgendas = consultaAgendas.eq('client_id', clientId)

  const [rLeads, rAgendas] = await Promise.all([consultaLeads, consultaAgendas])
  if (rLeads.error) console.error('[buscarPersonas] consulta de leads falló:', rLeads.error.code, rLeads.error.message)
  if (rAgendas.error) console.error('[buscarPersonas] consulta de agendas falló:', rAgendas.error.code, rAgendas.error.message)

  const t = q.toLowerCase()
  const tIg = q.replace(/^@/, '').toLowerCase()
  const encontrados = new Map<string, { fila: Record<string, unknown>; coincidencia: string }>()
  for (const l of (rLeads.data ?? []) as Record<string, unknown>[]) {
    const coincidencia = String(l.ig_username ?? '').toLowerCase().includes(tIg) ? 'instagram'
      : String(l.full_name ?? '').toLowerCase().includes(t) ? 'nombre'
      : String(l.email ?? '').toLowerCase().includes(t) ? 'correo'
      : 'telefono'
    encontrados.set(String(l.id), { fila: l, coincidencia })
  }

  const porAgenda = new Map<string, string>()
  for (const a of (rAgendas.data ?? []) as Record<string, unknown>[]) {
    const id = String(a.lead_id)
    if (encontrados.has(id) || porAgenda.has(id)) continue
    porAgenda.set(id, String(a.email_lead ?? '').toLowerCase().includes(t) ? 'agenda_correo' : 'agenda_nombre')
  }
  if (porAgenda.size > 0) {
    const { data: leadsDeAgenda } = await supabase
      .from('leads')
      .select('id, client_id, full_name, ig_username, stage, updated_at')
      .in('id', [...porAgenda.keys()])
    for (const l of (leadsDeAgenda ?? []) as Record<string, unknown>[]) {
      encontrados.set(String(l.id), { fila: l, coincidencia: porAgenda.get(String(l.id)) ?? 'agenda_nombre' })
    }
  }

  const clientIds = [...new Set([...encontrados.values()].map((e) => String(e.fila.client_id)))]
  const nombreCliente = new Map<string, string>()
  if (clientIds.length > 0) {
    const { data: clientes } = await supabase.from('clients').select('id, name').in('id', clientIds)
    for (const c of (clientes ?? []) as Record<string, unknown>[]) nombreCliente.set(String(c.id), String(c.name ?? ''))
  }

  return [...encontrados.values()]
    .map(({ fila, coincidencia }) => ({
      leadId: String(fila.id),
      clientId: String(fila.client_id),
      clientName: nombreCliente.get(String(fila.client_id)) || null,
      nombre: (fila.full_name as string | null) ?? null,
      igUsername: (fila.ig_username as string | null) ?? null,
      stage: (fila.stage as string | null) ?? null,
      coincidencia,
    }))
    .sort((a, b) => PRIORIDAD_COINCIDENCIA.indexOf(a.coincidencia) - PRIORIDAD_COINCIDENCIA.indexOf(b.coincidencia))
    .slice(0, 30)
}
