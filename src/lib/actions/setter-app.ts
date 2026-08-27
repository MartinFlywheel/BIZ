'use server'

import { createClient } from '@/lib/supabase/server'
import { getAgencyUsers } from './team'
import type { LeadStage } from '@/lib/types'

// Terminal stages excluded from the setter's day-to-day working list — a
// closed or disqualified lead has nothing left to action on a phone screen.
const TERMINAL_STAGES: LeadStage[] = ['no_calificado', 'cierre']

export interface SetterLeadCard {
  id: string
  full_name: string | null
  ig_username: string | null
  phone: string | null
  stage: string
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
  stage?: string
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
      stage: string; lead_avatar: string | null; updated_at: string
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

// ── Setter standards, progress, and daily reports ───────────────────────────
// See supabase/028-setter-standards.sql for why this reuses the existing
// leads.stage values instead of a new taxonomy.

const TRACKED_FOLLOWUP_STAGES: { stage: string; label: string }[] = [
  { stage: 'nuevo_contacto', label: 'Descubrimiento' },
  { stage: 'micro_vsl_enviado', label: 'Micro VSL' },
  { stage: 'vsl_chat', label: 'VSL Chat' },
  { stage: 'calendly_enviado', label: 'Calendly' },
]

// A single lead re-marked in the same stage counts at most twice toward
// that stage's follow-up quota — confirmed with the client: otherwise the
// number can be inflated by spamming one lead instead of real outreach
// breadth across the pipeline.
const MAX_FOLLOWUPS_PER_LEAD_STAGE = 2

export interface SetterGoals {
  minLeadsTouched: number
  minFollowupsPerStage: number
  minAgendasDay: number
  minAgendasWeek: number
  minAgendasMonth: number
  minBookingRate: number
}

const DEFAULT_GOALS: SetterGoals = {
  minLeadsTouched: 100,
  minFollowupsPerStage: 50,
  minAgendasDay: 7,
  minAgendasWeek: 5,
  minAgendasMonth: 20,
  minBookingRate: 10,
}

// Every field has a default so the feature works for a setter nobody has
// configured yet, instead of showing 0/0 or crashing. Falls back to a
// column-less query if min_agendas_day isn't migrated onto the live DB yet
// (supabase/029-setter-daily-agenda-goal.sql) — same 42703 pattern as
// users.lead_weight earlier in this project.
export async function getSetterGoals(userId: string, clientId: string): Promise<SetterGoals> {
  const supabase = await createClient()

  async function query(withDailyGoal: boolean) {
    const cols = `min_leads_touched, min_followups_per_stage, min_agendas_week, min_agendas_month, min_booking_rate${withDailyGoal ? ', min_agendas_day' : ''}`
    return supabase
      .from('setter_goals')
      .select(cols)
      .eq('user_id', userId)
      .eq('client_id', clientId)
      .maybeSingle()
  }

  let { data, error } = await query(true)
  if (error && (error as { code?: string }).code === '42703') {
    ({ data, error } = await query(false))
  }
  if (error) throw error

  if (!data) return DEFAULT_GOALS
  const row = data as unknown as {
    min_leads_touched: number; min_followups_per_stage: number; min_agendas_week: number
    min_agendas_month: number; min_booking_rate: number; min_agendas_day?: number
  }
  return {
    minLeadsTouched: row.min_leads_touched,
    minFollowupsPerStage: row.min_followups_per_stage,
    minAgendasDay: row.min_agendas_day ?? DEFAULT_GOALS.minAgendasDay,
    minAgendasWeek: row.min_agendas_week,
    minAgendasMonth: row.min_agendas_month,
    minBookingRate: Number(row.min_booking_rate),
  }
}

export async function setSetterGoals(userId: string, clientId: string, goals: Partial<SetterGoals>): Promise<void> {
  const supabase = await createClient()
  const current = await getSetterGoals(userId, clientId)
  const merged = { ...current, ...goals }

  const { error } = await supabase.from('setter_goals').upsert(
    {
      user_id: userId,
      client_id: clientId,
      min_leads_touched: merged.minLeadsTouched,
      min_followups_per_stage: merged.minFollowupsPerStage,
      min_agendas_day: merged.minAgendasDay,
      min_agendas_week: merged.minAgendasWeek,
      min_agendas_month: merged.minAgendasMonth,
      min_booking_rate: merged.minBookingRate,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,client_id' }
  )
  if (error) throw error
}

export interface CycleProgress {
  cycleStartedAt: string
  leadsTouched: number
  agendasSet: number
  followupsByStage: { stage: string; label: string; count: number }[]
  goals: SetterGoals
  needsReport: boolean
}

async function getCycleStart(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<string> {
  // A cycle isn't calendar-bound — it runs from the last submitted report
  // (or, for a brand-new setter, their first-ever logged touch) until the
  // next time min_leads_touched is crossed. A slow day and a fast day both
  // just end whenever the cycle completes; no timezone handling needed.
  const { data: lastReport } = await supabase
    .from('daily_setter_reports')
    .select('submitted_at')
    .eq('user_id', userId)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lastReport) return lastReport.submitted_at

  const { data: firstActivity } = await supabase
    .from('lead_activity_logs')
    .select('created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  return firstActivity?.created_at ?? new Date().toISOString()
}

export async function getCycleProgress(userId: string, clientId: string): Promise<CycleProgress> {
  const supabase = await createClient()
  const [goals, cycleStartedAt] = await Promise.all([
    getSetterGoals(userId, clientId),
    getCycleStart(supabase, userId),
  ])

  const { data, error } = await supabase
    .from('lead_activity_logs')
    .select('lead_id, action_type, stage_at_time')
    .eq('user_id', userId)
    .eq('client_id', clientId)
    .gte('created_at', cycleStartedAt)

  // 42P01 = undefined_table — supabase/028-setter-standards.sql might not
  // be migrated onto the live DB yet. Degrade to an empty, non-blocking
  // cycle instead of taking down the whole setter-app (leads list, agendas)
  // for every setter until someone runs it.
  if (error) {
    if ((error as { code?: string }).code === '42P01') {
      return {
        cycleStartedAt,
        leadsTouched: 0,
        agendasSet: 0,
        followupsByStage: TRACKED_FOLLOWUP_STAGES.map(({ stage, label }) => ({ stage, label, count: 0 })),
        goals,
        needsReport: false,
      }
    }
    throw error
  }

  const rows = (data || []) as { lead_id: string; action_type: 'contacto' | 'seguimiento'; stage_at_time: string }[]

  const leadsTouched = new Set(rows.map((r) => r.lead_id)).size
  const agendasSet = new Set(
    rows.filter((r) => r.action_type === 'contacto' && r.stage_at_time === 'agendado').map((r) => r.lead_id)
  ).size

  const followupsByStage = TRACKED_FOLLOWUP_STAGES.map(({ stage, label }) => {
    const perLead = new Map<string, number>()
    for (const r of rows) {
      if (r.action_type !== 'seguimiento' || r.stage_at_time !== stage) continue
      perLead.set(r.lead_id, (perLead.get(r.lead_id) || 0) + 1)
    }
    const count = [...perLead.values()].reduce((sum, n) => sum + Math.min(n, MAX_FOLLOWUPS_PER_LEAD_STAGE), 0)
    return { stage, label, count }
  })

  return {
    cycleStartedAt,
    leadsTouched,
    agendasSet,
    followupsByStage,
    goals,
    needsReport: leadsTouched >= goals.minLeadsTouched,
  }
}

export interface AgendaGoalProgress {
  agendasToday: number
  agendasThisWeek: number
  agendasThisMonth: number
  // The daily minimum is Mon-Fri only — the UI shouldn't show a "0/7" that
  // reads as failing on a weekend when there's no quota at all that day.
  isWeekday: boolean
}

// Calendar-bound (unlike the cycle above) — "agendas today/this week/month"
// is a standard cadence a manager checks regardless of where the setter is
// in their touch cycle. Same dual attribution as getMyAgendas: FK when the
// linked lead has one, free-text `setter` name fallback for hand-added
// agenda_records rows that have no lead_id to check.
export async function getAgendaGoalProgress(
  userId: string,
  clientId: string,
  setterFullName: string | null
): Promise<AgendaGoalProgress> {
  const supabase = await createClient()

  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const day = now.getDay()
  const isWeekday = day >= 1 && day <= 5
  const diffToMonday = day === 0 ? -6 : 1 - day
  const weekStartDate = new Date(now)
  weekStartDate.setDate(weekStartDate.getDate() + diffToMonday)
  const weekStart = weekStartDate.toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('agenda_records')
    .select('fecha_agenda, setter, leads(assigned_to)')
    .eq('client_id', clientId)
    .gte('fecha_agenda', monthStart)

  if (error) throw error

  const nameLower = setterFullName?.toLowerCase().trim()
  const rows = (data || []) as unknown as Array<{
    fecha_agenda: string | null; setter: string | null; leads: { assigned_to: string | null } | null
  }>

  const mine = rows.filter((r) =>
    r.leads?.assigned_to
      ? r.leads.assigned_to === userId
      : !!nameLower && !!r.setter && r.setter.toLowerCase().includes(nameLower)
  )

  return {
    agendasToday: mine.filter((r) => r.fecha_agenda === today).length,
    agendasThisWeek: mine.filter((r) => r.fecha_agenda && r.fecha_agenda >= weekStart).length,
    agendasThisMonth: mine.length,
    isWeekday,
  }
}

export interface SubmitReportInput {
  commonObjections: string
  marketingFeedback: string
}

export async function submitDailyReport(userId: string, clientId: string, input: SubmitReportInput): Promise<void> {
  const supabase = await createClient()
  const progress = await getCycleProgress(userId, clientId)
  const followupsTotal = progress.followupsByStage.reduce((sum, f) => sum + f.count, 0)

  const { error } = await supabase.from('daily_setter_reports').insert({
    user_id: userId,
    client_id: clientId,
    cycle_started_at: progress.cycleStartedAt,
    cycle_ended_at: new Date().toISOString(),
    leads_touched: progress.leadsTouched,
    agendas_set: progress.agendasSet,
    followups_total: followupsTotal,
    common_objections: input.commonObjections || null,
    marketing_feedback: input.marketingFeedback || null,
  })
  if (error) throw error
}

export interface DailyReportRow {
  id: string
  userId: string
  setterName: string | null
  clientId: string
  clientName: string | null
  leadsTouched: number
  agendasSet: number
  followupsTotal: number
  commonObjections: string | null
  marketingFeedback: string | null
  submittedAt: string
}

// Marketing/admin-facing feed of submitted reports, newest first.
export async function getDailySetterReports(clientId?: string): Promise<DailyReportRow[]> {
  const supabase = await createClient()

  let query = supabase
    .from('daily_setter_reports')
    .select(
      'id, user_id, client_id, leads_touched, agendas_set, followups_total, common_objections, marketing_feedback, submitted_at, users(full_name), clients(name)'
    )
    .order('submitted_at', { ascending: false })
    .limit(100)

  if (clientId) query = query.eq('client_id', clientId)

  const { data, error } = await query
  // 42P01 = undefined_table — migration not run yet; empty list beats a
  // broken /reports page.
  if (error) {
    if ((error as { code?: string }).code === '42P01') return []
    throw error
  }

  return (data || []).map((r) => {
    const row = r as unknown as {
      id: string; user_id: string; client_id: string; leads_touched: number; agendas_set: number
      followups_total: number; common_objections: string | null; marketing_feedback: string | null
      submitted_at: string; users: { full_name: string | null } | null; clients: { name: string | null } | null
    }
    return {
      id: row.id,
      userId: row.user_id,
      setterName: row.users?.full_name ?? null,
      clientId: row.client_id,
      clientName: row.clients?.name ?? null,
      leadsTouched: row.leads_touched,
      agendasSet: row.agendas_set,
      followupsTotal: row.followups_total,
      commonObjections: row.common_objections,
      marketingFeedback: row.marketing_feedback,
      submittedAt: row.submitted_at,
    }
  })
}

export interface SetterProgressRow {
  userId: string
  fullName: string | null
  cycle: CycleProgress
  agendas: AgendaGoalProgress
}

// Admin-facing live view — getCycleProgress/getAgendaGoalProgress already
// take an arbitrary userId, not just "whoever's logged in", so this is
// just fanning them out across the client's roster. A completed report
// only shows up once a setter crosses their quota and submits; this is
// the "how's everyone doing right now" view for the cycle in progress.
export async function getSettersProgress(clientId: string): Promise<SetterProgressRow[]> {
  const users = await getAgencyUsers(clientId)
  const setters = users.filter((s) => s.role === 'setter')

  const rows = await Promise.all(
    setters.map(async (s) => ({
      userId: s.id,
      fullName: s.full_name,
      cycle: await getCycleProgress(s.id, clientId),
      agendas: await getAgendaGoalProgress(s.id, clientId, s.full_name),
    }))
  )

  return rows
}
