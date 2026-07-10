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
