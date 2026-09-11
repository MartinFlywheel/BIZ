// Plain constants/types shared between server actions and client components.
// Deliberately NOT a 'use server' file — those may only export async
// functions, so shared consts/types live here instead.

export const OVERRIDABLE_FIELDS = [
  'views_reels', 'views_historias', 'chats_abiertos', 'conversaciones',
  'agendas', 'shows', 'cierres', 'facturacion', 'cash_collected',
] as const

export type OverridableField = typeof OVERRIDABLE_FIELDS[number]

// ── Estados de agenda_records ────────────────────────────────────────────
// Estas listas estaban escritas a mano, literal, en metrics.ts, live-metrics.ts
// y team.ts, y se desincronizaron: el dashboard sumaba 'No Calificado' al
// denominador del show rate y la tabla de Equipo no, asi que la misma metrica
// daba dos numeros distintos segun que pantalla la mostrara. Viven aca para que
// eso no pueda volver a pasar sin que se vea.

/**
 * La llamada ya tuvo desenlace: es el denominador del show rate en todas
 * partes (dashboard, funnel, cron de benchmarks y tabla de Equipo).
 *
 * Quedan fuera 'Pendiente' y 'Reagendado', que todavia no ocurrieron, y
 * 'No Calificado', que se descarto antes de la llamada. Ninguno de los tres es
 * una ausencia: contarlos como no-shows hundia a quien tuviera agendas recien
 * puestas y favorecia a quien solo tenia historial viejo ya resuelto.
 */
export const ESTADOS_CON_DESENLACE = ['Show', 'No Show', 'No Cerrado', 'Cerrado'] as const

/** El lead se presento a la llamada. */
export const ESTADOS_ASISTIO = ['Show', 'No Cerrado', 'Cerrado'] as const

/** Descartado antes de la llamada. No entra al denominador del show rate; se
 *  reporta aparte en PeriodMetrics.llamadas_no_calificadas. */
export const ESTADO_NO_CALIFICADO = 'No Calificado'

export const ESTADO_CERRADO = 'Cerrado'
