'use server'

import { createClient } from '@/lib/supabase/server'
import type { LeadStage } from '@/lib/types'

// Terminal stages excluded from the setter's day-to-day working list — a
// closed or disqualified lead has nothing left to action on a phone screen.
const TERMINAL_STAGES: LeadStage[] = ['no_calificado', 'cierre']

export interface SetterLeadCard {
  id: string
  full_name: string | null
  ig_username: string | null
  phone: string | null
  stage: LeadStage
  lead_avatar: string | null
  updated_at: string
  classification: string | null
  // Only populated for an admin's "todos" view — a setter looking at their
  // own leads already knows whose they are.
  assignedToName: string | null
}

export interface SetterContext {
  userId: string
  fullName: string | null
  clientId: string | null
  clientName: string | null
  isAdmin: boolean
}

// Resolves who's looking at the app and which client's leads they work —
// the layout already checked auth/is_active, this just gets the ids the
// page needs. Admins have no client_id of their own; ?client= picks one
// for them the same way the desktop Dashboard's client selector does.
export async function getSetterContext(requestedClientId?: string): Promise<SetterContext | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('users')
    .select('full_name, role, client_id')
    .eq('id', user.id)
    .single()
  if (!profile) return null

  const clientId = profile.role === 'admin' ? (requestedClientId ?? null) : profile.client_id

  let clientName: string | null = null
  if (clientId) {
    const { data: client } = await supabase.from('clients').select('name').eq('id', clientId).maybeSingle()
    clientName = client?.name ?? null
  }

  return { userId: user.id, fullName: profile.full_name, clientId, clientName, isAdmin: profile.role === 'admin' }
}

const PAGE_SIZE = 30

// Still in an active stage, most recently touched first — the working list
// for a phone screen, not the full historical pipeline (a client can have
// thousands of leads; nobody is scrolling through that on a phone, and
// nobody needs to — closed/disqualified leads have nothing left to do).
//
// setterId scopes to one person's assigned leads (what a setter sees —
// their own caseload only). Pass null for an admin's oversight view: every
// active lead for the client regardless of who it's assigned to, with the
// assignee's name attached since it's no longer implicitly "mine".
export interface LeadFilters {
  search?: string
  stage?: LeadStage
}

export async function getMyActiveLeads(
  clientId: string,
  setterId: string | null,
  page = 0,
  filters?: LeadFilters
): Promise<{ leads: SetterLeadCard[]; hasMore: boolean }> {
  const supabase = await createClient()

  const from = page * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const select = setterId
    ? 'id, full_name, ig_username, phone, stage, lead_avatar, updated_at, interactions(classification)'
    : 'id, full_name, ig_username, phone, stage, lead_avatar, updated_at, interactions(classification), users!leads_assigned_to_fkey(full_name)'

  let query = supabase.from('leads').select(select).eq('client_id', clientId)

  if (setterId) query = query.eq('assigned_to', setterId)

  // Picking a specific stage (including a terminal one, e.g. reviewing
  // closed deals) overrides the "active only" default — otherwise exclude
  // closed/disqualified, nothing left to action on those.
  if (filters?.stage) {
    query = query.eq('stage', filters.stage)
  } else {
    query = query.not('stage', 'in', `(${TERMINAL_STAGES.join(',')})`)
  }

  const search = filters?.search?.trim()
  if (search) {
    const escaped = search.replace(/[%_]/g, (c) => `\\${c}`)
    query = query.or(`full_name.ilike.%${escaped}%,ig_username.ilike.%${escaped}%`)
  }

  query = query.order('updated_at', { ascending: false }).range(from, to)

  const { data, error } = await query
  if (error) throw error

  const leads: SetterLeadCard[] = (data || []).map((l) => {
    const row = l as unknown as {
      id: string; full_name: string | null; ig_username: string | null; phone: string | null
      stage: LeadStage; lead_avatar: string | null; updated_at: string
      interactions?: { classification?: string } | null
      users?: { full_name: string | null } | null
    }
    return {
      id: row.id,
      full_name: row.full_name,
      ig_username: row.ig_username,
      phone: row.phone,
      stage: row.stage,
      lead_avatar: row.lead_avatar,
      updated_at: row.updated_at,
      classification: row.interactions?.classification ?? null,
      assignedToName: row.users?.full_name ?? null,
    }
  })

  return { leads, hasMore: leads.length === PAGE_SIZE }
}

export async function getMyClientOptions(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient()
  const { data } = await supabase.from('clients').select('id, name').order('name')
  return data ?? []
}

// ── Agendas ───────────────────────────────────────────────────────────────
// AGENDA_ESTADOS lives in the component that uses it, not here — a 'use
// server' file can only export async functions, not plain constants.

export interface SetterAgendaRow {
  id: string
  leadId: string | null
  nombreLead: string | null
  avatar: string | null
  fechaAgenda: string | null
  estado: string | null
  deDondeVino: string | null
}

// Not every agenda_records row has a lead_id — some are added by hand for
// calls ManyChat never captured as a lead, so this can't be an inner join
// (that would silently drop exactly those rows). Fetched whole and filtered
// in JS instead: FK-based (leads.assigned_to) when the linked lead has one,
// falling back to the free-text `setter` column for the hand-added rows
// that have no lead to check against.
export async function getMyAgendas(
  clientId: string,
  setterId: string | null,
  setterFullName: string | null
): Promise<SetterAgendaRow[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('agenda_records')
    .select('id, lead_id, nombre_lead, avatar, fecha_agenda, estado, de_donde_vino, setter, leads(assigned_to)')
    .eq('client_id', clientId)
    .order('fecha_agenda', { ascending: true })

  if (error) throw error

  const rows = (data || []) as unknown as Array<{
    id: string; lead_id: string | null; nombre_lead: string | null; avatar: string | null
    fecha_agenda: string | null; estado: string | null; de_donde_vino: string | null
    setter: string | null; leads: { assigned_to: string | null } | null
  }>

  const nameLower = setterFullName?.toLowerCase().trim()
  const filtered = setterId
    ? rows.filter((r) =>
        r.leads?.assigned_to
          ? r.leads.assigned_to === setterId
          : !!nameLower && !!r.setter && r.setter.toLowerCase().includes(nameLower)
      )
    : rows

  return filtered.map((r) => ({
    id: r.id,
    leadId: r.lead_id,
    nombreLead: r.nombre_lead,
    avatar: r.avatar,
    fechaAgenda: r.fecha_agenda,
    estado: r.estado,
    deDondeVino: r.de_donde_vino,
  }))
}
