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
export async function getAgencyUsers(clientId?: string) {
  const supabase = await createClient()
  const base = supabase
    .from('users')
    .select('id, full_name, email, role, client_id, lead_weight')
    .eq('user_type', 'agency')
    .eq('is_active', true)

  if (!clientId) {
    const { data, error } = await base.order('full_name')
    if (error) throw error
    return data
  }

  // Two plain .eq() queries + merge, instead of building a raw .or() filter
  // string from clientId (avoids PostgREST filter-syntax injection).
  const [adminsRes, teamRes] = await Promise.all([
    base.eq('role', 'admin'),
    supabase
      .from('users')
      .select('id, full_name, email, role, client_id, lead_weight')
      .eq('user_type', 'agency')
      .eq('is_active', true)
      .eq('client_id', clientId),
  ])

  if (adminsRes.error) throw adminsRes.error
  if (teamRes.error) throw teamRes.error

  const byId = new Map([...adminsRes.data, ...teamRes.data].map((u) => [u.id, u]))
  return [...byId.values()].sort((a, b) => a.full_name.localeCompare(b.full_name))
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

export async function getAgendaTeamStats(clientId: string): Promise<Record<string, { agendas: number; shows: number; cerradas: number }>> {
  const supabase = await createClient()
  const data = await fetchAllRows((from, to) =>
    supabase
      .from('agenda_records')
      .select('closer, setter, estado')
      .eq('client_id', clientId)
      .range(from, to)
  )

  const stats: Record<string, { agendas: number; shows: number; cerradas: number }> = {}

  function bump(name: string | null | undefined, estado: string | null) {
    const key = name?.trim()
    if (!key) return
    if (!stats[key]) stats[key] = { agendas: 0, shows: 0, cerradas: 0 }
    stats[key].agendas++
    if (estado === 'Show' || estado === 'No Cerrado' || estado === 'Cerrado') stats[key].shows++
    if (estado === 'Cerrado') stats[key].cerradas++
  }

  // A setter's number is "leads they booked" and a closer's is "calls they
  // took" — different roles on the same row, so both get credit for it
  // (unless it's literally the same name in both fields, which would
  // otherwise double-count one row as two agendas for that person).
  for (const r of data) {
    bump(r.setter, r.estado)
    if (r.closer?.trim() && r.closer.trim() !== r.setter?.trim()) bump(r.closer, r.estado)
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
    return { success: false, error: 'No podés eliminar tu propia cuenta' }
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
