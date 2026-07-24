'use server'

import { createClient } from '@/lib/supabase/server'

export interface AgendaRecord {
  id: string
  client_id: string
  lead_id: string | null
  fecha_agendado: string | null
  fecha_agenda: string | null
  link_perfil: string | null
  nombre_lead: string | null
  avatar: string | null
  de_donde_vino: string | null
  fecha_1er_contacto: string | null
  primer_cta: string | null
  todos_los_ctas: string | null
  closer: string | null
  estado: string | null
  objecion: string | null
  situacion_actual: string | null
  facturacion_actual: number | null
  dolores: string | null
  preguntas_no_resueltas: string | null
  aporte_a_mkt: string | null
  link_reunion: string | null
  link_reporte: string | null
  programa_ofrecido: string | null
  forma_de_cierre: string | null
  monto_facturacion: number | null
  monto_upfront: number | null
  razon_de_compra: string | null
  comentarios: string | null
  created_at: string
  updated_at: string
}

export type AgendaRecordFields = Partial<Omit<AgendaRecord, 'id' | 'client_id' | 'created_at' | 'updated_at'>>

export async function getAgendaRecords(clientId: string, year: number, month: number): Promise<AgendaRecord[]> {
  const supabase = await createClient()
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  const { data, error } = await supabase
    .from('agenda_records')
    .select('*')
    .eq('client_id', clientId)
    .gte('fecha_agenda', start)
    .lte('fecha_agenda', end)
    .order('fecha_agenda', { ascending: true })

  if (error) throw error
  return (data ?? []) as AgendaRecord[]
}

export async function createAgendaRecord(clientId: string, fields: AgendaRecordFields = {}): Promise<AgendaRecord> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('agenda_records')
    .insert({ client_id: clientId, ...fields })
    .select()
    .single()
  if (error) throw error
  return data as AgendaRecord
}

export async function updateAgendaRecord(id: string, fields: AgendaRecordFields): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('agenda_records')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteAgendaRecord(id: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('agenda_records').delete().eq('id', id)
  if (error) throw error
}

export interface AgendaLeadOption {
  lead_id: string
  nombre_lead: string | null
  avatar: string | null
  de_donde_vino: string | null
  closer: string | null
  fecha_agenda: string | null
}

// Leads that are already booked (have an Agendas row) — used to scope the
// "Registrar Llamada" lead picker instead of every lead ever created, and to
// prefill the call date/context so it doesn't need retyping.
export async function getAgendaLeadOptions(clientId: string): Promise<AgendaLeadOption[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('agenda_records')
    .select('lead_id, nombre_lead, avatar, de_donde_vino, closer, fecha_agenda')
    .eq('client_id', clientId)
    .not('lead_id', 'is', null)
    .order('fecha_agenda', { ascending: false })

  if (error) throw error
  return (data ?? []) as AgendaLeadOption[]
}
