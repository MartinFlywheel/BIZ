'use server'

import { createClient } from '@/lib/supabase/server'

export interface DailyChatMetric {
  id: string
  client_id: string
  date: string
  chats_abiertos: number
  conversaciones: number
  agendas: number
  llamadas: number
  shows: number
  llamadas_no_calificadas: number
  cierres: number
  seniados: number
  total_facturacion: number
  total_cash: number
  created_at: string
}

export type ChatMetricFields = Partial<Omit<DailyChatMetric, 'id' | 'client_id' | 'date' | 'created_at'>>

// Closing metrics derived from agenda_records — read-only, never manually entered
export interface DayClosingStats {
  date: string
  llamadas: number
  shows: number
  llamadas_no_calificadas: number
  cierres: number
  seniados: number
  total_facturacion: number
  total_cash: number
}

export async function getDailyChatMetrics(clientId: string, year: number, month: number): Promise<DailyChatMetric[]> {
  const supabase = await createClient()
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  const { data, error } = await supabase
    .from('daily_chat_metrics')
    .select('*')
    .eq('client_id', clientId)
    .gte('date', start)
    .lte('date', end)
    .order('date', { ascending: true })

  if (error) throw error
  return (data ?? []) as DailyChatMetric[]
}

export async function saveDailyChatMetric(clientId: string, date: string, fields: ChatMetricFields): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('daily_chat_metrics')
    .upsert({ client_id: clientId, date, ...fields }, { onConflict: 'client_id,date' })
  if (error) throw error
}

export async function deleteDailyChatMetric(clientId: string, date: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('daily_chat_metrics')
    .delete()
    .eq('client_id', clientId)
    .eq('date', date)
  if (error) throw error
}

// Derives closing metrics from agenda_records for a given client/month.
// Llamadas = calls with an outcome (Show/No Show/Cerrado/No Calificado)
// Shows    = attended the call (Show or Cerrado)
// Cierres  = closed deal
// Facturación/Cash = sums from closed records
export async function getClosingMetricsFromAgenda(
  clientId: string,
  year: number,
  month: number,
): Promise<Record<string, DayClosingStats>> {
  const supabase = await createClient()
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  const { data, error } = await supabase
    .from('agenda_records')
    .select('fecha_agenda, estado, monto_facturacion, monto_upfront')
    .eq('client_id', clientId)
    .gte('fecha_agenda', start)
    .lte('fecha_agenda', end)

  if (error) throw error

  const byDate: Record<string, DayClosingStats> = {}

  for (const record of data ?? []) {
    const date = record.fecha_agenda as string | null
    if (!date) continue
    if (!byDate[date]) {
      byDate[date] = { date, llamadas: 0, shows: 0, llamadas_no_calificadas: 0, cierres: 0, seniados: 0, total_facturacion: 0, total_cash: 0 }
    }
    const s = byDate[date]
    const estado = record.estado as string | null

    if (estado && ['Show', 'No Show', 'Cerrado', 'No Calificado'].includes(estado)) s.llamadas++
    if (estado && ['Show', 'Cerrado'].includes(estado)) s.shows++
    if (estado === 'No Calificado') s.llamadas_no_calificadas++
    if (estado === 'Cerrado') {
      s.cierres++
      s.total_facturacion += Number(record.monto_facturacion) || 0
      s.total_cash += Number(record.monto_upfront) || 0
    }
  }

  return byDate
}
