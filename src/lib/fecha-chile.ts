// Fechas en hora de Chile, iguales en el servidor y en el navegador.
//
// Vercel no define TZ, así que en el servidor `new Date().getMonth()` es el
// mes en UTC. Desde las 21:00 (20:00 en invierno) del último día del mes, el
// servidor ya estaba en el mes siguiente: la tabla Mensual encabezaba con un
// mes que todavía no empezaba y los selectores de mes lo ofrecían. Todo "hoy"
// y "mes actual" del negocio sale de aquí, con la zona fija, para que la
// respuesta no dependa de dónde corre el código.
//
// Deliberadamente NO es un archivo 'use server': son funciones puras y
// síncronas que también usan los componentes de cliente.
//
// Formatos: los días van como 'YYYY-MM-DD' y los meses como 'YYYY-MM'. Las
// cuentas con días se hacen sobre esos strings anclados a las 12:00 UTC, así
// que ningún cambio de horario puede correr la fecha.

export const ZONA_CHILE = 'America/Santiago'

export interface FechaChile {
  year: number
  month: number // 1-12
  day: number
  iso: string // YYYY-MM-DD
}

// Intl.DateTimeFormat es caro de construir; se reutiliza una sola instancia.
let formatoChile: Intl.DateTimeFormat | null = null

function formato(): Intl.DateTimeFormat {
  if (!formatoChile) {
    formatoChile = new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONA_CHILE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  }
  return formatoChile
}

/** La fecha calendario de Chile que corresponde a un instante. */
export function fechaChileDe(instante: Date | string | number = new Date()): FechaChile {
  const fecha = instante instanceof Date ? instante : new Date(instante)
  const partes = formato().formatToParts(fecha)
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value)
  const year = valor('year')
  const month = valor('month')
  const day = valor('day')
  return { year, month, day, iso: `${year}-${dos(month)}-${dos(day)}` }
}

export function hoyChile(): FechaChile {
  return fechaChileDe(new Date())
}

/** 'YYYY-MM' del mes en curso en Chile. */
export function mesActualChile(): string {
  return hoyChile().iso.slice(0, 7)
}

/** 'YYYY-MM-DD' en hora de Chile de un timestamp (timestamptz de Postgres). */
export function isoChileDe(timestamp: string | Date): string {
  return fechaChileDe(timestamp).iso
}

export function dos(n: number): string {
  return String(n).padStart(2, '0')
}

export function mesDe(fecha: string): string {
  return fecha.slice(0, 7)
}

export function mesComoNumeros(mes: string): { year: number; month: number } {
  return { year: Number(mes.slice(0, 4)), month: Number(mes.slice(5, 7)) }
}

export function aMes(year: number, month: number): string {
  return `${year}-${dos(month)}`
}

/** Negativo si a < b, 0 si son iguales, positivo si a > b. Sirve para días y meses. */
export function comparar(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function sumarMeses(mes: string, n: number): string {
  const { year, month } = mesComoNumeros(mes)
  const total = year * 12 + (month - 1) + n
  return aMes(Math.floor(total / 12), (total % 12) + 1)
}

/** Meses desde `desde` hasta `hasta`, ambos incluidos. Vacío si desde > hasta. */
export function mesesEntre(desde: string, hasta: string): string[] {
  const meses: string[] = []
  for (let mes = desde; mes <= hasta; mes = sumarMeses(mes, 1)) meses.push(mes)
  return meses
}

/** Ajusta un mes al rango [min, max]. */
export function acotarMes(mes: string, min: string, max: string): string {
  if (mes < min) return min
  if (mes > max) return max
  return mes
}

export function ultimoDiaDelMes(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function primerDiaDelMes(mes: string): string {
  return `${mes}-01`
}

export function ultimoDiaDe(mes: string): string {
  const { year, month } = mesComoNumeros(mes)
  return `${mes}-${dos(ultimoDiaDelMes(year, month))}`
}

export function sumarDias(fecha: string, n: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 0 = domingo … 6 = sábado, de una fecha calendario. */
export function diaDeLaSemana(fecha: string): number {
  return new Date(`${fecha}T12:00:00Z`).getUTCDay()
}

/** Lunes de la semana (lunes a domingo) que contiene la fecha. */
export function lunesDe(fecha: string): string {
  const dia = diaDeLaSemana(fecha)
  return sumarDias(fecha, dia === 0 ? -6 : 1 - dia)
}

export function minFecha(a: string, b: string): string {
  return a < b ? a : b
}

export function maxFecha(a: string, b: string): string {
  return a > b ? a : b
}
