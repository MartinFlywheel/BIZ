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

// Assigned to this setter, still in an active stage, most recently touched
// first — the working list for a phone screen, not the full historical
// pipeline (a client can have thousands of leads; nobody is scrolling
// through that on a phone, and nobody needs to — closed/disqualified leads
// have nothing left to do).
export async function getMyActiveLeads(
  clientId: string,
  setterId: string,
  page = 0
): Promise<{ leads: SetterLeadCard[]; hasMore: boolean }> {
  const supabase = await createClient()

  const from = page * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const { data, error } = await supabase
    .from('leads')
    .select('id, full_name, ig_username, phone, stage, lead_avatar, updated_at, interactions(classification)')
    .eq('client_id', clientId)
    .eq('assigned_to', setterId)
    .not('stage', 'in', `(${TERMINAL_STAGES.join(',')})`)
    .order('updated_at', { ascending: false })
    .range(from, to)

  if (error) throw error

  const leads: SetterLeadCard[] = (data || []).map((l) => ({
    id: l.id,
    full_name: l.full_name,
    ig_username: l.ig_username,
    phone: l.phone,
    stage: l.stage as LeadStage,
    lead_avatar: l.lead_avatar,
    updated_at: l.updated_at,
    classification: (l as unknown as { interactions?: { classification?: string } | null }).interactions?.classification ?? null,
  }))

  return { leads, hasMore: leads.length === PAGE_SIZE }
}

export async function getMyClientOptions(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient()
  const { data } = await supabase.from('clients').select('id, name').order('name')
  return data ?? []
}
