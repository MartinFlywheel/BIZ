import type { createAdminClient } from '@/lib/supabase/admin'

/**
 * El resultado de la llamada llega al lead.
 *
 * El equipo marca el estado en la agenda (planilla o reporte aprobado), pero
 * nada movía al lead: de las 17 agendas "Cerrado" de Mane, 15 leads seguían en
 * "agendado" y ninguno tenía closed_at. lead-funnel, ad-attribution y
 * content-analytics cuentan cierres por etapa del lead, así que daban 0.
 *
 * Reglas (vocabulario de etapas de la 063):
 *  - Cerrado        → cierre, con closed_at = hora de la llamada y close_value
 *                     = monto de la venta (facturación, o upfront si no hay).
 *  - No Calificado  → no_calificado.
 *  - Show, No Show, No Cerrado, Reagendado, Pendiente → al menos agendado. La
 *    063 ya decidió que asistir o no asistir no es una etapa: el detalle vive
 *    en la agenda, y quien no cerró sigue siendo alguien a quien hacer
 *    seguimiento.
 *  - Nunca retrocede: un lead en cierre no vuelve a agendado porque una
 *    segunda agenda diga "No Show".
 *  - Corrección: si la agenda decía Cerrado (o No Calificado) y se cambia, y el
 *    lead está en esa etapa sin otra agenda que la sostenga, vuelve a agendado.
 *    Es deshacer lo que hizo esta misma regla, no un retroceso.
 *  - Si el cliente tiene etapas propias sin la etapa de destino, no se toca
 *    (mismo criterio que la 063 y moverLeadAAgendado).
 */

type Supabase = ReturnType<typeof createAdminClient>

export interface AgendaResultado {
  id: string
  client_id: string
  lead_id: string | null
  estado: string | null
  monto_facturacion: number | null
  monto_upfront: number | null
  hora_agenda: string | null
  fecha_agenda: string | null
  cancelada_at?: string | null
}

export interface LeadResultado {
  id: string
  stage: string
  closed_at: string | null
  close_value: number | null
}

export interface CambioLead {
  leadId: string
  agendaId: string
  desde: string
  hasta: string
  motivo: string
  campos: Record<string, unknown>
}

const ETAPAS_CIERRE = new Set(['cierre', 'cliente', 'closed_won'])
const ETAPAS_DESCARTE = new Set(['no_calificado', 'closed_lost'])
const ETAPAS_AGENDADO = new Set(['agendado', 'agenda_set'])

function rango(stage: string): number {
  if (ETAPAS_CIERRE.has(stage)) return 3
  if (ETAPAS_DESCARTE.has(stage)) return 2
  if (ETAPAS_AGENDADO.has(stage)) return 1
  return 0
}

/** Monto de la venta: facturación y, si no se cargó, upfront (mismo criterio que content-analytics). */
export function montoDeVenta(a: Pick<AgendaResultado, 'monto_facturacion' | 'monto_upfront'>): number | null {
  const f = Number(a.monto_facturacion)
  if (Number.isFinite(f) && f > 0) return f
  const u = Number(a.monto_upfront)
  if (Number.isFinite(u) && u > 0) return u
  return null
}

/** Cuándo fue la llamada. Sin hora exacta, el mediodía de Chile de ese día. */
function momentoDeLaLlamada(a: AgendaResultado): string {
  if (a.hora_agenda) return new Date(a.hora_agenda).toISOString()
  if (a.fecha_agenda) return new Date(`${a.fecha_agenda}T16:00:00Z`).toISOString()
  return new Date().toISOString()
}

/**
 * Qué habría que cambiarle al lead. Pura: no lee ni escribe, para que el
 * backfill pueda simular varias agendas del mismo lead en orden.
 *
 * @param etapasCliente ids de clients.pipeline_stages, o null si usa las de siempre
 * @param otrasAgendas estados de las otras agendas del mismo lead (sin canceladas)
 */
export function calcularCambio(
  agenda: AgendaResultado,
  lead: LeadResultado,
  etapasCliente: string[] | null,
  otrasAgendas: string[],
  estadoAnterior?: string | null
): CambioLead | null {
  const disponible = (etapa: string) => !etapasCliente || etapasCliente.length === 0 || etapasCliente.includes(etapa)
  const estado = agenda.estado ?? ''
  const actual = rango(lead.stage)
  const base = { leadId: lead.id, agendaId: agenda.id, desde: lead.stage }

  if (estado === 'Cerrado') {
    const monto = montoDeVenta(agenda)
    if (actual === 3) {
      // Ya está cerrado. Solo se corrige el monto si esta es la única venta
      // del lead: con dos agendas cerradas no hay forma de saber cuál manda.
      const otraCerrada = otrasAgendas.includes('Cerrado')
      if (!otraCerrada && monto !== null && Number(lead.close_value) !== monto) {
        return { ...base, hasta: lead.stage, motivo: 'monto de la venta', campos: { close_value: monto } }
      }
      return null
    }
    if (!disponible('cierre')) return null
    return {
      ...base,
      hasta: 'cierre',
      motivo: 'agenda Cerrado',
      campos: {
        stage: 'cierre',
        closed_at: momentoDeLaLlamada(agenda),
        close_value: monto,
        next_follow_up_date: null,
      },
    }
  }

  // Corrección de un resultado terminal que ya no es tal.
  const deshace =
    (estadoAnterior === 'Cerrado' && ETAPAS_CIERRE.has(lead.stage) && !otrasAgendas.includes('Cerrado')) ||
    (estadoAnterior === 'No Calificado' && ETAPAS_DESCARTE.has(lead.stage) && !otrasAgendas.includes('No Calificado') && !otrasAgendas.includes('Cerrado'))
  if (deshace && estadoAnterior !== estado) {
    const destino = estado === 'No Calificado' ? 'no_calificado' : 'agendado'
    if (!disponible(destino)) return null
    return {
      ...base,
      hasta: destino,
      motivo: `corrección: la agenda dejó de ser ${estadoAnterior}`,
      campos: {
        stage: destino,
        closed_at: null,
        close_value: null,
        days_to_close: null,
        ...(destino === 'agendado' ? { agenda_at: agenda.hora_agenda ?? momentoDeLaLlamada(agenda) } : {}),
      },
    }
  }

  if (estado === 'No Calificado') {
    if (actual >= 2 || !disponible('no_calificado')) return null
    return {
      ...base,
      hasta: 'no_calificado',
      motivo: 'agenda No Calificado',
      campos: { stage: 'no_calificado', closed_at: momentoDeLaLlamada(agenda), next_follow_up_date: null },
    }
  }

  if (['Show', 'No Show', 'No Cerrado', 'Reagendado', 'Pendiente'].includes(estado)) {
    if (actual >= 1 || !disponible('agendado')) return null
    return {
      ...base,
      hasta: 'agendado',
      motivo: `agenda ${estado}`,
      campos: {
        stage: 'agendado',
        agenda_at: agenda.hora_agenda ?? momentoDeLaLlamada(agenda),
        next_follow_up_date: null,
        follow_up_count: 0,
      },
    }
  }

  return null
}

/**
 * Lee la agenda, su lead y las otras agendas del lead, y aplica el cambio.
 *
 * Nunca lanza: el estado de la agenda ya quedó guardado, y un fallo al mover
 * el lead no puede deshacer eso ni mostrarle un error a quien solo cambió una
 * celda. Devuelve el cambio aplicado (o null) para registrarlo.
 */
export async function aplicarResultadoAgenda(
  supabase: Supabase,
  agendaId: string,
  opciones: { estadoAnterior?: string | null } = {}
): Promise<CambioLead | null> {
  try {
    const { data: agenda, error } = await supabase
      .from('agenda_records')
      .select('id, client_id, lead_id, estado, monto_facturacion, monto_upfront, hora_agenda, fecha_agenda, cancelada_at')
      .eq('id', agendaId)
      .maybeSingle()
    if (error || !agenda?.lead_id || agenda.cancelada_at) return null

    const [leadRes, clienteRes, otrasRes] = await Promise.all([
      supabase.from('leads').select('id, stage, closed_at, close_value').eq('id', agenda.lead_id).maybeSingle(),
      supabase.from('clients').select('pipeline_stages').eq('id', agenda.client_id).maybeSingle(),
      supabase
        .from('agenda_records')
        .select('estado, cancelada_at')
        .eq('lead_id', agenda.lead_id)
        .neq('id', agendaId),
    ])
    if (!leadRes.data) return null

    const etapas = ((clienteRes.data?.pipeline_stages ?? null) as { id: string }[] | null)?.map((e) => e.id) ?? null
    const otras = (otrasRes.data ?? []).filter((o) => !o.cancelada_at).map((o) => (o.estado as string | null) ?? '')

    const cambio = calcularCambio(agenda as AgendaResultado, leadRes.data as LeadResultado, etapas, otras, opciones.estadoAnterior)
    if (!cambio) return null

    const { error: errorUpdate } = await supabase
      .from('leads')
      .update({ ...cambio.campos, updated_at: new Date().toISOString() })
      .eq('id', cambio.leadId)
      // Si otra escritura ya movió al lead, no se pisa con una lectura vieja.
      .eq('stage', cambio.desde)
    if (errorUpdate) {
      console.error(`[resultado-agenda] no se pudo mover el lead ${cambio.leadId}: ${errorUpdate.message}`)
      return null
    }
    return cambio
  } catch (e) {
    console.error('[resultado-agenda] error al aplicar el resultado de la agenda:', e)
    return null
  }
}
