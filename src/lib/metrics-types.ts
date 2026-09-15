// Plain constants/types shared between server actions and client components.
// Deliberately NOT a 'use server' file — those may only export async
// functions, so shared consts/types live here instead.

// followers_gained entró aquí cuando dejó de ser un campo solo manual: el valor
// automático sale de los insights diarios de Meta (ig_account_daily_insights,
// migración 073) y se corrige en Diario igual que el resto. Semanal y Mensual
// suman los días.
export const OVERRIDABLE_FIELDS = [
  'views_reels', 'views_historias', 'followers_gained', 'chats_abiertos', 'conversaciones',
  'agendas', 'shows', 'cierres', 'facturacion', 'cash_collected',
] as const

export type OverridableField = typeof OVERRIDABLE_FIELDS[number]

/**
 * Las correcciones del Diario que trae una fila de client_metrics.
 *
 * NULL = sin corrección (manda el valor automático). Cualquier número, incluido
 * 0, es una corrección.
 *
 * Excepción mientras la migración 073 no esté aplicada: client_metrics.
 * followers_gained tenía DEFAULT 0, así que toda fila creada al corregir otro
 * campo nace con 0 seguidores y se leería como "corregido a 0", tapando el dato
 * de Meta y pintando la celda de ámbar. La 073 quita ese DEFAULT, pasa esos 0 a
 * NULL y crea ig_account_daily_insights en el mismo archivo, así que "la tabla
 * de insights existe" es la señal de que un 0 ya es intencional. Antes de eso
 * un 0 en followers_gained se ignora.
 */
export function leerCorrecciones(
  fila: Record<string, unknown> | undefined,
  migracion073Aplicada: boolean,
): Partial<Record<OverridableField, number>> {
  const correcciones: Partial<Record<OverridableField, number>> = {}
  if (!fila) return correcciones
  for (const campo of OVERRIDABLE_FIELDS) {
    const valor = fila[campo]
    if (valor === null || valor === undefined || valor === '') continue
    const numero = Number(valor)
    if (!Number.isFinite(numero)) continue
    if (campo === 'followers_gained' && numero === 0 && !migracion073Aplicada) continue
    correcciones[campo] = numero
  }
  return correcciones
}

/** Columnas de client_metrics que se leen para las correcciones del Diario. */
export const COLUMNAS_CORRECCIONES = `period_start, ${OVERRIDABLE_FIELDS.join(', ')}`

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
