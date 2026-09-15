'use server'

import { createClient } from '@/lib/supabase/server'
import { getInicioDelCliente, getLiveMetricsBuckets, type PeriodMetrics } from './live-metrics'
import { aMes, dos, hoyChile, maxFecha, mesDe, minFecha, sumarMeses, ultimoDiaDelMes } from '@/lib/fecha-chile'

export type DailyLiveMetric = PeriodMetrics & { date: string }

// One row per day of the given month, computed live from interactions
// (ManyChat) and agenda_records (Calendly + CRM closing) — no manual entry.
//
// Nunca genera días posteriores a hoy en Chile, y un mes futuro devuelve []:
// antes aparecían filas del 15 y 16 con las agendas pendientes de esos días y
// "Total Mes" las sumaba. El tope vive aquí y no solo en el selector, para que
// valga aunque alguien pida un mes futuro a mano.
export async function getDailyLiveMetrics(
  clientId: string,
  year: number,
  month: number,
): Promise<DailyLiveMetric[]> {
  const hoy = hoyChile().iso
  const mes = aMes(year, month)
  if (mes > mesDe(hoy)) return []

  const lastDay = ultimoDiaDelMes(year, month)
  const buckets = Array.from({ length: lastDay }, (_, i) => {
    const date = `${mes}-${dos(i + 1)}`
    return { key: date, start: date, end: date }
  }).filter((b) => b.start <= hoy)

  const byDate = await getLiveMetricsBuckets(clientId, buckets)
  return buckets.map((b) => ({ date: b.key, ...byDate[b.key] }))
}

export interface RangoDeMeses {
  min: string // YYYY-MM
  max: string // YYYY-MM
}

/**
 * Meses que tiene sentido ofrecer en los selectores de mes.
 *
 * - 'chat' (Chat Diario de Analítica): desde el mes de inicio del cliente
 *   hasta el mes en curso de Chile. Un mes futuro no tiene chats.
 * - 'agendas' (planilla de Agendas): desde el mes de la primera agenda (o el
 *   inicio del cliente si no tiene) hasta el mayor entre el mes siguiente al
 *   actual y el mes de la última agenda, porque hay llamadas agendadas por
 *   adelantado.
 *
 * Antes los dos selectores ofrecían los 12 meses de tres años fijos, sin
 * relación con los datos. Si algo falla se devuelve el rango de respaldo (12
 * meses hacia atrás) en vez de dejar el selector vacío.
 */
export async function getRangoDeMeses(clientId: string, vista: 'chat' | 'agendas'): Promise<RangoDeMeses> {
  const mesActual = mesDe(hoyChile().iso)
  const respaldo: RangoDeMeses = {
    min: sumarMeses(mesActual, -12),
    max: vista === 'agendas' ? sumarMeses(mesActual, 1) : mesActual,
  }

  try {
    const inicio = await getInicioDelCliente(clientId)

    if (vista === 'chat') {
      return { min: inicio ? minFecha(mesDe(inicio), mesActual) : respaldo.min, max: mesActual }
    }

    const supabase = await createClient()
    const [primera, ultima] = await Promise.all([
      supabase
        .from('agenda_records')
        .select('fecha_agenda')
        .eq('client_id', clientId)
        .not('fecha_agenda', 'is', null)
        .order('fecha_agenda', { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('agenda_records')
        .select('fecha_agenda')
        .eq('client_id', clientId)
        .not('fecha_agenda', 'is', null)
        .order('fecha_agenda', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const primeraAgenda = (primera.data?.fecha_agenda as string | undefined) ?? null
    const ultimaAgenda = (ultima.data?.fecha_agenda as string | undefined) ?? null
    const desde = primeraAgenda ?? inicio
    const min = desde ? minFecha(mesDe(desde), mesActual) : respaldo.min
    const max = maxFecha(sumarMeses(mesActual, 1), ultimaAgenda ? mesDe(ultimaAgenda) : mesActual)
    return { min, max }
  } catch (e) {
    console.error('[chat-metrics] getRangoDeMeses:', e instanceof Error ? e.message : e)
    return respaldo
  }
}
