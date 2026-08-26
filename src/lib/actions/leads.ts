'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import type { LeadStage } from '@/lib/types'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { pickBalancedSetter } from '@/lib/manychat'

export async function getLeads(clientId?: string) {
  const supabase = await createClient()

  return fetchAllRows((from, to) => {
    let query = supabase
      .from('leads')
      .select('*, clients(name, ig_handle), users!leads_assigned_to_fkey(full_name), interactions(classification)')
      .order('updated_at', { ascending: false })
      .range(from, to)

    if (clientId) query = query.eq('client_id', clientId)
    return query
  })
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

// Bare id/name for the "which lead is this call about" lookup in the
// Llamadas tab — no joins, none of the CRM tab's full row, so it stays
// fast even for a client with thousands of leads.
export async function getLeadOptions(clientId: string): Promise<{ id: string; full_name: string | null; ig_username: string | null }[]> {
  const supabase = await createClient()
  return fetchAllRows((from, to) =>
    supabase
      .from('leads')
      .select('id, full_name, ig_username')
      .eq('client_id', clientId)
      .range(from, to)
  )
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
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  const { data: viewer } = authUser
    ? await supabase.from('users').select('role').eq('id', authUser.id).single()
    : { data: null }
  const isSetter = viewer?.role === 'setter'

  const leads = await getLeads(clientId)
  if (!isSetter) return leads

  return leads.filter((lead) => {
    const classification = (lead as { interactions?: { classification?: string } | null }).interactions?.classification
    const isQualifiedForSomeoneElse = classification === 'lead_calificado' && lead.assigned_to && lead.assigned_to !== authUser?.id
    return !isQualifiedForSomeoneElse
  })
}

export async function updateLeadStageAction(id: string, stage: LeadStage, agendaDate?: string): Promise<{ agendaError: string | null }> {
  const supabase = await createClient()

  const { data: { user: authUser } } = await supabase.auth.getUser()

  // Needed to tell a real advance from a re-marked "still here" touch —
  // fetched before the update overwrites it.
  const { data: existing } = await supabase.from('leads').select('stage').eq('id', id).maybeSingle()
  const previousStage = existing?.stage as LeadStage | undefined

  const updates: Record<string, unknown> = {
    stage,
    updated_at: new Date().toISOString(),
  }

  const isAgendaStage = stage === 'agendado' || stage === 'agenda_set'
  if (isAgendaStage) updates.agenda_at = new Date().toISOString()
  if (stage === 'cliente' || stage === 'closed_won') updates.closed_at = new Date().toISOString()

  const { data: lead, error } = await supabase
    .from('leads')
    .update(updates)
    .eq('id', id)
    .select('id, client_id, full_name, content_id, first_touch_at, first_touch_type, lead_avatar')
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

async function ensureAgendaRecordForLead(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lead: { id: string; client_id: string; full_name: string | null; content_id: string | null; first_touch_at: string | null; first_touch_type: string | null; lead_avatar: string | null },
  agendaDate: string
) {
  const { data: existing, error: existingError } = await supabase
    .from('agenda_records')
    .select('id')
    .eq('lead_id', lead.id)
    .maybeSingle()
  if (existingError) {
    console.error('[ensureAgendaRecordForLead] lookup failed:', existingError.message)
    throw existingError
  }
  if (existing) return

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
    keyword = lead.first_touch_type.match(/^manychat:(.+)$/)?.[1] || null
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

export async function createLeadAction(formData: FormData) {
  const supabase = await createClient()
  const clientId = formData.get('client_id') as string

  // Every lead needs an owner — same balanced pick the ManyChat webhooks
  // use, so a lead added by hand doesn't sit unassigned just because
  // nobody checked a box. Falls back to null only if the client genuinely
  // has no active setter on the team.
  const assignedTo = (formData.get('assigned_to') as string) || await pickBalancedSetter(createAdminClient(), clientId)

  const { error } = await supabase.from('leads').insert({
    client_id: clientId,
    ig_username: (formData.get('ig_username') as string) || null,
    full_name: (formData.get('full_name') as string) || null,
    phone: (formData.get('phone') as string) || null,
    email: (formData.get('email') as string) || null,
    stage: (formData.get('stage') as LeadStage) || 'nuevo_contacto',
    content_id: (formData.get('content_id') as string) || null,
    lead_avatar: (formData.get('lead_avatar') as string) || null,
    assigned_to: assignedTo,
    close_value: formData.get('close_value')
      ? parseFloat(formData.get('close_value') as string)
      : null,
  })

  if (error) throw error
  revalidatePath('/leads')
  revalidatePath(`/clients/${clientId}`)
}

export async function updateLeadFieldsAction(id: string, fields: {
  full_name?: string | null
  ig_username?: string | null
  phone?: string | null
  email?: string | null
  lead_avatar?: string | null
  assigned_to?: string | null
  content_id?: string | null
  notes?: string | null
}) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('leads')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
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
