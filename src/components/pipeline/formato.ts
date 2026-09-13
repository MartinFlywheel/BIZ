/**
 * Formato de fechas y plazos del Pipeline de Agendas.
 *
 * Todo en hora de Chile: el equipo trabaja desde ahí, y mostrar la hora del
 * navegador haría que la misma llamada figure a horas distintas según quién
 * abra el CRM.
 */

export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return 'sin hora'
  return new Date(iso).toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function duracion(ms: number): string {
  const min = Math.round(Math.abs(ms) / 60_000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) {
    const m = min % 60
    return m > 0 && h < 6 ? `${h} h ${m} min` : `${h} h`
  }
  return `${Math.round(h / 24)} días`
}

export type Tono = 'normal' | 'urgente' | 'vencido'

/** Normal con más de 2 h, urgente con menos, vencido pasado el plazo. */
export function tonoVencimiento(venceAt: string | null | undefined, ahora = Date.now()): Tono {
  if (!venceAt) return 'normal'
  const falta = new Date(venceAt).getTime() - ahora
  if (falta <= 0) return 'vencido'
  if (falta < 2 * 3_600_000) return 'urgente'
  return 'normal'
}

export function textoVencimiento(venceAt: string | null | undefined, ahora = Date.now()): string {
  if (!venceAt) return 'sin plazo'
  const falta = new Date(venceAt).getTime() - ahora
  return falta <= 0 ? `venció hace ${duracion(falta)}` : `vence en ${duracion(falta)}`
}
