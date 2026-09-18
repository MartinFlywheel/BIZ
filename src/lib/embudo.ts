import type { FunnelStage, Responsibility } from '@/lib/types'

/**
 * Las metas del embudo y cómo se evalúa. Una sola definición para todo lo que
 * juzga si una tasa está bien o mal: el embudo del Dashboard
 * (calculateFunnel), el aviso diario (api/cron/check-benchmarks) y la lista de
 * metas de Configuración.
 *
 * Antes había dos juegos: el embudo con estas metas escritas en el código y la
 * tabla `benchmarks` (25% respuesta, 60% show-up, 20% cierre), que usaban las
 * tarjetas del Dashboard y el aviso. Una misma tasa podía salir verde en el
 * embudo y "Falla" en la tarjeta de al lado.
 *
 * A propósito sin 'use server': son datos y una función pura que también usan
 * componentes y rutas.
 */

export interface MetaEtapa {
  id: 'chats' | 'conversaciones' | 'agendas' | 'shows' | 'cierres'
  label: string
  /** Qué se divide por qué, en palabras. */
  formula: string
  min: number
  max: number
  /** A quién le toca cuando la tasa queda bajo la meta (team_assignments.responsibility). */
  area: Responsibility
  diagnostico: string
}

export const METAS_EMBUDO: MetaEtapa[] = [
  {
    id: 'chats', label: 'Chats', formula: 'chats / vistas', min: 1, max: 3, area: 'content',
    diagnostico: 'El contenido no está generando chats: revisar ganchos y CTA.',
  },
  {
    id: 'conversaciones', label: 'Conversaciones', formula: 'conversaciones / chats', min: 70, max: 100, area: 'content',
    diagnostico: 'Pocos chats pasan a conversación real: el CTA o el mensaje automático no conecta con quien escribe.',
  },
  {
    id: 'agendas', label: 'Agendas', formula: 'agendas / conversaciones', min: 8, max: 12, area: 'setting',
    diagnostico: 'Pocas conversaciones llegan a agenda: revisar el setting y el pitch.',
  },
  {
    id: 'shows', label: 'Shows', formula: 'shows / llamadas', min: 70, max: 100, area: 'setting',
    diagnostico: 'Mucha gente no se presenta: revisar confirmación y seguimiento antes de la llamada.',
  },
  {
    id: 'cierres', label: 'Cierres', formula: 'cierres / shows', min: 30, max: 60, area: 'closing',
    diagnostico: 'Pocos shows terminan en venta: revisar script, manejo de objeciones y oferta.',
  },
]

export interface DatosEmbudo {
  vistas: number
  chats: number
  conversaciones: number
  agendas: number
  /** Agendas cuya llamada ya tuvo desenlace: el denominador de los shows. */
  llamadas: number
  shows: number
  cierres: number
}

function tasa(parte: number, total: number): number {
  return total > 0 ? (parte / total) * 100 : 0
}

/**
 * Cada etapa con su valor, su tasa desde la etapa anterior y si cumple la
 * meta, más el cuello de botella: la etapa más lejos bajo su meta. Una etapa
 * a la que no llegó nadie (denominador 0) no se diagnostica: el problema está
 * más arriba.
 */
export function evaluarEmbudo(d: DatosEmbudo): {
  stages: FunnelStage[]
  bottleneck: string | null
  bottleneck_drop: number
} {
  const valores: Record<MetaEtapa['id'], { value: number; denominador: number }> = {
    chats: { value: d.chats, denominador: d.vistas },
    conversaciones: { value: d.conversaciones, denominador: d.chats },
    agendas: { value: d.agendas, denominador: d.conversaciones },
    shows: { value: d.shows, denominador: d.llamadas },
    cierres: { value: d.cierres, denominador: d.shows },
  }

  const etapas = METAS_EMBUDO.map((m) => {
    const { value, denominador } = valores[m.id]
    return { meta: m, value, denominador, rate: tasa(value, denominador) }
  })

  let worstDrop = 0
  let bottleneck: string | null = null
  for (const e of etapas) {
    if (e.denominador === 0 || e.rate >= e.meta.min) continue
    const drop = e.meta.min - e.rate
    if (drop > worstDrop) {
      worstDrop = drop
      bottleneck = e.meta.id
    }
  }

  const stages: FunnelStage[] = [
    // La entrada del embudo no tiene tasa ni meta.
    {
      id: 'vistas', label: 'Vistas', value: d.vistas, rate: 0, benchmark_min: 0, benchmark_max: 0,
      status: 'healthy', is_bottleneck: false,
    },
    ...etapas.map((e): FunnelStage => ({
      id: e.meta.id,
      label: e.meta.label,
      value: e.value,
      rate: Math.round(e.rate * 100) / 100,
      benchmark_min: e.meta.min,
      benchmark_max: e.meta.max,
      status: e.denominador === 0 || e.rate >= e.meta.min ? 'healthy' : 'critical',
      is_bottleneck: e.meta.id === bottleneck,
    })),
  ]

  return { stages, bottleneck, bottleneck_drop: Math.round(worstDrop * 100) / 100 }
}
