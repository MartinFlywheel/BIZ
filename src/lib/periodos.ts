import { hoyChile, lunesDe, minFecha, sumarDias, sumarMeses, ultimoDiaDe } from '@/lib/fecha-chile'

/**
 * Los períodos del Dashboard y sus fechas. Lo usan el embudo (calculateFunnel)
 * y la comparativa con el período anterior, para que los dos miren exactamente
 * los mismos días.
 *
 * A propósito sin 'use server': son funciones puras y síncronas.
 */

export type FunnelPeriodType = 'daily' | 'weekly' | 'monthly' | '15d' | '30d'

export interface Rango {
  start: string
  end: string
}

// Límites completos de un período ([start, end], ambos incluidos), anclado en
// periodStart si viene, o en hoy de Chile si no.
//
// "Hoy" se calcula en hora de Chile y no con new Date(): Vercel corre en UTC,
// y desde las 21:00 del último día del mes el servidor ya tomaba el mes
// siguiente como el actual. Las cuentas se hacen sobre strings de fecha, sin
// depender de la zona del proceso.
export function limitesDelPeriodo(periodType: FunnelPeriodType, periodStart?: string): Rango {
  const anchor = periodStart || hoyChile().iso

  if (periodType === 'daily') {
    return { start: anchor, end: anchor }
  }

  if (periodType === 'monthly') {
    const mes = anchor.slice(0, 7)
    return { start: `${mes}-01`, end: ultimoDiaDe(mes) }
  }

  // Rolling trailing window ending on the anchor date (today, unless a
  // specific end was given) — not calendar-aligned like week/month.
  if (periodType === '15d' || periodType === '30d') {
    const days = periodType === '15d' ? 15 : 30
    return { start: sumarDias(anchor, -(days - 1)), end: anchor }
  }

  const monday = lunesDe(anchor)
  return { start: monday, end: sumarDias(monday, 6) }
}

// Igual que limitesDelPeriodo, pero el período en curso termina hoy: los días
// que todavía no pasan no se cuentan (incluidas las agendas ya puestas para
// esos días). Un período futuro queda con end < start, o sea, vacío.
export function periodBounds(periodType: FunnelPeriodType, periodStart?: string): Rango {
  const { start, end } = limitesDelPeriodo(periodType, periodStart)
  return { start, end: minFecha(end, hoyChile().iso) }
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000) + 1
}

/**
 * El período contra el que se compara `actual`, con la misma cantidad de días.
 *
 * Antes la comparativa enfrentaba el mes en curso (1–18 sept) contra el mes
 * anterior completo (31 días de agosto): todo salía a la baja solo por tener
 * menos días. Ahora:
 *   - Semana: los mismos días de la semana anterior (lun–vie contra lun–vie).
 *   - Mes: los mismos días del mes anterior (1–18 sept contra 1–18 ago; si el
 *     mes anterior es más corto, hasta su último día).
 *   - 15 días, 30 días y personalizado: la misma cantidad de días justo antes.
 */
export function periodoAnterior(periodType: FunnelPeriodType | 'custom', actual: Rango): Rango {
  if (periodType === 'weekly') {
    return { start: sumarDias(actual.start, -7), end: sumarDias(actual.end, -7) }
  }
  if (periodType === 'monthly') {
    const mesAnterior = sumarMeses(actual.start.slice(0, 7), -1)
    const start = `${mesAnterior}-01`
    return { start, end: minFecha(sumarDias(start, diasEntre(actual.start, actual.end) - 1), ultimoDiaDe(mesAnterior)) }
  }
  const n = diasEntre(actual.start, actual.end)
  return { start: sumarDias(actual.start, -n), end: sumarDias(actual.start, -1) }
}
