import type { Llamada, ResultadoLlamada } from '@/lib/actions/llamadas'
import { isoChileDe } from '@/lib/fecha-chile'

/**
 * Formato compartido de la pestaña Llamadas y la página /calls.
 *
 * Las fechas van siempre en hora de Chile: el equipo trabaja desde ahí, y usar
 * la zona del navegador haría que la misma llamada figure en días distintos
 * según quién abra el CRM.
 */

export function fechaLlamada(l: Pick<Llamada, 'cuando' | 'conHora'>): string {
  if (!l.cuando) return 'Sin fecha'
  if (l.conHora) {
    return new Date(l.cuando).toLocaleString('es-CL', {
      timeZone: 'America/Santiago',
      weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    })
  }
  // Solo día: se ancla al mediodía UTC para que ninguna zona lo corra.
  return new Date(`${l.cuando.slice(0, 10)}T12:00:00Z`).toLocaleDateString('es-CL', {
    timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  })
}

export function fechaCorta(fecha: string | null | undefined): string {
  if (!fecha) return 'sin fecha'
  return new Date(`${fecha.slice(0, 10)}T12:00:00Z`).toLocaleDateString('es-CL', {
    timeZone: 'UTC', day: '2-digit', month: 'short',
  })
}

/** Mes 'YYYY-MM' de la llamada en hora de Chile, o null si no tiene fecha. */
export function mesLlamada(l: Pick<Llamada, 'cuando' | 'conHora'>): string | null {
  if (!l.cuando) return null
  return l.conHora ? isoChileDe(l.cuando).slice(0, 7) : l.cuando.slice(0, 7)
}

/** 'YYYY-MM' → "septiembre 2026". */
export function nombreMes(mes: string): string {
  return new Date(`${mes}-15T12:00:00Z`).toLocaleDateString('es-CL', { timeZone: 'UTC', month: 'long', year: 'numeric' })
}

export type FiltroLlamadas =ResultadoLlamada | 'sin_agenda' | 'todas'

export const RESULTADO_BADGE: Record<ResultadoLlamada, { etiqueta: string; variante: 'default' | 'success' | 'warning' | 'danger' | 'info' }> = {
  cerrada: { etiqueta: 'Cerrada', variante: 'success' },
  no_cerrada: { etiqueta: 'No cerrada', variante: 'default' },
  no_show: { etiqueta: 'No show', variante: 'danger' },
  pendiente: { etiqueta: 'Pendiente de resultado', variante: 'warning' },
  otro: { etiqueta: 'Otro', variante: 'info' },
}

export function coincideFiltro(l: Llamada, filtro: FiltroLlamadas): boolean {
  if (filtro === 'todas') return true
  if (filtro === 'sin_agenda') return l.origen === 'grabacion_suelta'
  return l.origen !== 'grabacion_suelta' && l.resultado === filtro
}

/** Quita los enlaces de marcas de tiempo del markdown de Fathom: "[texto](url)" → "texto". */
export function resumenLegible(md: string): string {
  return md.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1').replace(/\*\*/g, '')
}
