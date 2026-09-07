'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import type { Responsibility } from '@/lib/types'
import { fetchAllRows } from '@/lib/supabase/paginate'

export async function getTeamAssignments(clientId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('team_assignments')
    .select('*, users(full_name, email, role)')
    .eq('client_id', clientId)
    .order('responsibility')

  if (error) throw error
  return data
}

// Each business has its own team: admins (unscoped) see/manage every client,
// everyone else is tied to the one client they were added under. Pass
// clientId to get that client's roster (admins + their assigned people);
// omit it for the old unscoped global list (e.g. the agency-wide /calls page).
interface AgencyUserRow {
  id: string
  full_name: string
  email: string
  role: string
  client_id: string | null
  lead_weight?: number
}

export async function getAgencyUsers(clientId?: string) {
  async function query(withWeight: boolean) {
    const supabase = await createClient()
    const cols = `id, full_name, email, role, client_id${withWeight ? ', lead_weight' : ''}`
    const base = () => supabase.from('users').select<string, AgencyUserRow>(cols).eq('user_type', 'agency').eq('is_active', true)

    if (!clientId) {
      const { data, error } = await base().order('full_name')
      if (error) throw error
      return data
    }

    // Two plain .eq() queries + merge, instead of building a raw .or() filter
    // string from clientId (avoids PostgREST filter-syntax injection).
    const [adminsRes, teamRes] = await Promise.all([
      base().eq('role', 'admin'),
      base().eq('client_id', clientId),
    ])

    if (adminsRes.error) throw adminsRes.error
    if (teamRes.error) throw teamRes.error

    const byId = new Map([...adminsRes.data, ...teamRes.data].map((u) => [u.id, u]))
    return [...byId.values()].sort((a, b) => a.full_name.localeCompare(b.full_name))
  }

  try {
    return await query(true)
  } catch (error) {
    // lead_weight (supabase/025-setter-lead-weight.sql) might not be
    // migrated onto the live DB yet — degrade instead of taking down every
    // client page that renders the team roster. 42703 = undefined_column;
    // anything else is a real error and should still surface.
    if ((error as { code?: string } | null)?.code !== '42703') throw error
    const data = await query(false)
    return data.map((u) => ({ ...u, lead_weight: 1 }))
  }
}

export async function createAssignmentAction(formData: FormData) {
  const supabase = await createClient()
  const clientId = formData.get('client_id') as string

  const { error } = await supabase.from('team_assignments').insert({
    client_id: clientId,
    user_id: formData.get('user_id') as string,
    responsibility: formData.get('responsibility') as Responsibility,
    is_primary: formData.get('is_primary') === 'true',
  })

  if (error) throw error
  revalidatePath(`/clients/${clientId}`)
}

export interface TeamMemberStats {
  // Lado setter: lo que consiguió agendar.
  agendas: number    // todas sus filas como setter, resueltas o no
  resueltas: number  // las que ya tienen desenlace — el denominador del show rate
  shows: number      // de esas, las que asistieron
  // Lado closer: las llamadas que atendió.
  llamadas: number   // agendas que ocurrieron con él como closer — denominador del close rate
  cerradas: number   // de esas, las que cerró
}

// Una agenda Pendiente o Reagendada todavía no ocurrió, y una No Calificado se
// descartó antes de la llamada: ninguna es show ni no-show. Antes entraban al
// denominador del show rate como si fueran ausencias, así que hundían a quien
// tuviera agendas recién puestas y favorecían a quien sólo tenía historial
// viejo ya resuelto.
const ESTADOS_RESUELTOS = new Set(['Show', 'No Show', 'No Cerrado', 'Cerrado'])
// El lead se presentó. 'No Cerrado' y 'Cerrado' implican que la llamada pasó.
const ESTADOS_ASISTIO = new Set(['Show', 'No Cerrado', 'Cerrado'])

// agenda_records.setter y .closer son texto libre, escrito a mano. Sin
// normalizar, un "magui" o un "Magui  Del Pazo" con doble espacio no le sumaba
// a nadie: la fila se perdía en silencio.
function normalizarNombre(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/s+/g, ' ')
    .trim()
}

// PostgREST tipa todo join como arreglo aunque la relación sea a uno, y el
// tipo generado no distingue el caso. Se acepta cualquiera de las dos formas y
// se normaliza al leer, igual que en getAgendaGoalProgress.
type FilaAgenda = {
  closer: string | null
  setter: string | null
  estado: string | null
  leads: { assigned_to: string | null } | { assigned_to: string | null }[] | null
}

/**
 * Métricas por persona, separando los dos papeles que puede tener en una misma
 * agenda.
 *
 * No se decide por el campo `role`: un admin baja a setear cuando hace falta, y
 * un setter no cierra nunca. Quién hizo qué se lee de la fila — del campo
 * `setter` sale el show rate, del campo `closer` sale el close rate — así que
 * cada quien recibe sólo las métricas de los papeles que efectivamente ocupó.
 */
export async function getAgendaTeamStats(clientId: string): Promise<Record<string, TeamMemberStats>> {
  const supabase = await createClient()

  const [roster, data] = await Promise.all([
    getAgencyUsers(clientId),
    fetchAllRows<FilaAgenda>((from, to) =>
      supabase
        .from('agenda_records')
        .select('closer, setter, estado, leads(assigned_to)')
        .eq('client_id', clientId)
        .range(from, to) as unknown as PromiseLike<{ data: FilaAgenda[] | null; error: { message: string } | null }>
    ),
  ])

  const porNombre = new Map<string, string>()
  for (const u of roster) porNombre.set(normalizarNombre(u.full_name), u.id)

  const resolver = (nombre: string | null | undefined): string | null => {
    const key = nombre?.trim()
    return key ? porNombre.get(normalizarNombre(key)) ?? null : null
  }

  const stats: Record<string, TeamMemberStats> = {}
  function bucket(userId: string): TeamMemberStats {
    if (!stats[userId]) stats[userId] = { agendas: 0, resueltas: 0, shows: 0, llamadas: 0, cerradas: 0 }
    return stats[userId]
  }

  for (const r of data) {
    const resuelta = ESTADOS_RESUELTOS.has(r.estado ?? '')
    const asistio = ESTADOS_ASISTIO.has(r.estado ?? '')

    // El nombre manda sobre el FK: se escribe al agendar y es el registro
    // histórico de quién consiguió ESA agenda. leads.assigned_to es el dueño
    // actual del lead, que cambia si se reasigna, así que sólo entra como
    // respaldo cuando el nombre viene vacío o no cruza con nadie del equipo.
    const lead = Array.isArray(r.leads) ? r.leads[0] : r.leads
    const setterId = resolver(r.setter) ?? lead?.assigned_to ?? null
    if (setterId) {
      const b = bucket(setterId)
      b.agendas++
      if (resuelta) b.resueltas++
      if (asistio) b.shows++
    }

    // Al closer sólo se le cuentan las llamadas que ocurrieron: que el lead no
    // se presente no es algo que él controle, y arrastrarlo a su denominador
    // le cobraría el trabajo de agendamiento de otro.
    const closerId = resolver(r.closer)
    if (closerId && asistio) {
      const b = bucket(closerId)
      b.llamadas++
      if (r.estado === 'Cerrado') b.cerradas++
    }
  }

  return stats
}

// Shared confirmation phrase for an admin changing their OWN role — not real
// per-user auth, just a guard rail against fat-fingering the dropdown and
// locking yourself out. Checked server-side since a client-only check would
// be trivial to bypass.
const SELF_ROLE_CHANGE_PASSWORD = 'Holakase6.'

// Editing anyone's profile (role especially — this is how privilege
// escalation would happen) is admin-only. Without this check, any non-admin
// who can see their client's Equipo tab could have promoted themselves (or
// anyone else) to admin via the role dropdown.
export async function updateAgencyUserAction(
  userId: string,
  fields: { full_name?: string; email?: string; role?: string; client_id?: string | null; lead_weight?: number },
  confirmPassword?: string
): Promise<{ success: true } | { success: false; error: string }> {
  const supabase = await createClient()
  const { data: { user: currentUser } } = await supabase.auth.getUser()
  if (!currentUser) return { success: false, error: 'No autenticado' }

  const { data: caller } = await supabase
    .from('users')
    .select('role, user_type')
    .eq('id', currentUser.id)
    .single()

  if (!caller || caller.user_type !== 'agency' || caller.role !== 'admin') {
    return { success: false, error: 'Solo un admin puede editar a otras personas del equipo' }
  }

  if (userId === currentUser.id && fields.role && fields.role !== caller.role) {
    if (confirmPassword !== SELF_ROLE_CHANGE_PASSWORD) {
      return { success: false, error: 'Contraseña incorrecta — no se cambió tu rol' }
    }
  }

  const { error } = await supabase
    .from('users')
    .update(fields)
    .eq('id', userId)
  if (error) return { success: false, error: error.message }
  return { success: true }
}

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let pw = ''
  for (let i = 0; i < 14; i++) pw += chars[Math.floor(Math.random() * chars.length)]
  return pw
}

// Creates a real login (Supabase Auth user + users row) for a new agency
// team member — only an existing admin can do this. Returns a one-time
// temp password to hand to the new person (no invite-email flow yet).
export async function createAgencyUserAction(formData: FormData): Promise<
  | { success: true; tempPassword: string; user: { id: string; full_name: string; email: string; role: string } }
  | { success: false; error: string }
> {
  const supabase = await createClient()
  const { data: { user: currentUser } } = await supabase.auth.getUser()
  if (!currentUser) return { success: false, error: 'No autenticado' }

  const { data: caller } = await supabase
    .from('users')
    .select('role, user_type')
    .eq('id', currentUser.id)
    .single()

  if (!caller || caller.user_type !== 'agency' || caller.role !== 'admin') {
    return { success: false, error: 'Solo un admin puede agregar personas al equipo' }
  }

  const email = (formData.get('email') as string)?.trim().toLowerCase()
  const fullName = (formData.get('full_name') as string)?.trim()
  const role = formData.get('role') as string
  const clientId = (formData.get('client_id') as string) || null

  if (!email || !fullName || !role) return { success: false, error: 'Faltan datos' }
  // Non-admins are scoped to one business — only admins are unscoped across
  // all clients, so every other role needs the client it's being added for.
  if (role !== 'admin' && !clientId) {
    return { success: false, error: 'Falta el cliente al que pertenece esta persona' }
  }

  const admin = createAdminClient()
  const tempPassword = generateTempPassword()

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })

  if (createError || !created.user) {
    return { success: false, error: createError?.message || 'No se pudo crear la cuenta' }
  }

  const { error: insertError } = await admin.from('users').insert({
    id: created.user.id,
    email,
    full_name: fullName,
    user_type: 'agency',
    role,
    client_id: role === 'admin' ? null : clientId,
    is_active: true,
  })

  if (insertError) {
    // Roll back the orphaned auth account so a failed insert doesn't leave a
    // login with no profile row behind.
    await admin.auth.admin.deleteUser(created.user.id)
    return { success: false, error: insertError.message }
  }

  return { success: true, tempPassword, user: { id: created.user.id, full_name: fullName, email, role } }
}

// Fully revokes access — deletes the users row AND the underlying Supabase
// Auth account (invalidates their sessions immediately), not just a soft
// is_active flag. is_active exists but nothing in auth/session checks it, so
// deactivating alone would NOT actually block them from logging back in.
export async function deleteAgencyUserAction(userId: string): Promise<{ success: true } | { success: false; error: string }> {
  const supabase = await createClient()
  const { data: { user: currentUser } } = await supabase.auth.getUser()
  if (!currentUser) return { success: false, error: 'No autenticado' }

  const { data: caller } = await supabase
    .from('users')
    .select('role, user_type')
    .eq('id', currentUser.id)
    .single()

  if (!caller || caller.user_type !== 'agency' || caller.role !== 'admin') {
    return { success: false, error: 'Solo un admin puede eliminar personas del equipo' }
  }

  if (userId === currentUser.id) {
    return { success: false, error: 'No puedes eliminar tu propia cuenta' }
  }

  const admin = createAdminClient()

  // Several tables FK to users(id) with no ON DELETE behavior, so deleting
  // the profile row outright fails the moment this person has anything
  // pointing at them (leads assigned to them was the one that surfaced this —
  // a setter/closer with thousands of leads couldn't be deleted at all).
  // Unassign what's just a pointer (their name stays out of it entirely),
  // and drop what's NOT NULL / meaningless once they're gone (their own
  // notifications, team_assignments rows, authored content notes).
  const [leadsRes, callsRes, tasksRes, teamRes, notesRes, notifRes] = await Promise.all([
    admin.from('leads').update({ assigned_to: null }).eq('assigned_to', userId),
    admin.from('sales_calls').update({ caller_id: null }).eq('caller_id', userId),
    admin.from('onboarding_tasks').update({ assigned_to: null }).eq('assigned_to', userId),
    admin.from('team_assignments').delete().eq('user_id', userId),
    admin.from('content_notes').delete().eq('author_id', userId),
    admin.from('notifications').delete().eq('user_id', userId),
  ])
  for (const r of [leadsRes, callsRes, tasksRes, teamRes, notesRes, notifRes]) {
    if (r.error) return { success: false, error: r.error.message }
  }

  // users.id references auth.users(id) with no ON DELETE CASCADE, so the
  // profile row has to go first or the auth deletion is rejected by the FK.
  const { error: deleteRowError } = await admin.from('users').delete().eq('id', userId)
  if (deleteRowError) return { success: false, error: deleteRowError.message }

  const { error: deleteAuthError } = await admin.auth.admin.deleteUser(userId)
  if (deleteAuthError) return { success: false, error: deleteAuthError.message }

  return { success: true }
}

export async function deleteAssignmentAction(id: string, clientId: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('team_assignments').delete().eq('id', id)

  if (error) throw error
  revalidatePath(`/clients/${clientId}`)
}
