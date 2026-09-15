'use client'

import { useEffect } from 'react'
import { aMes, acotarMes, mesActualChile, mesComoNumeros, sumarMeses } from '@/lib/fecha-chile'

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

/**
 * Selector de mes y año acotado a un rango.
 *
 * Reemplaza los dos selectores duplicados de Chat Diario y de la planilla de
 * Agendas, que ofrecían los 12 meses de tres años fijos (año anterior, actual y
 * siguiente) sin mirar los datos: se podía elegir diciembre de 2027.
 *
 * - Los años van del año de `min` al de `max`, y en el primero y el último
 *   solo aparecen los meses dentro del rango.
 * - Al cambiar de año, el mes se ajusta al rango (diciembre 2025 → 2026 con
 *   tope en septiembre queda en septiembre).
 * - Si el mes elegido queda fuera del rango (por ejemplo, porque el rango
 *   llegó después del estado inicial), se corrige solo para que el <select>
 *   nunca muestre un valor que no existe.
 *
 * Sin rango, respalda con los últimos 12 meses hasta el mes actual de Chile,
 * que es lo que se usa mientras carga el rango real.
 */
export function MonthSelector({
  year,
  month,
  onChange,
  min,
  max,
}: {
  year: number
  month: number
  onChange: (year: number, month: number) => void
  min?: string // YYYY-MM
  max?: string // YYYY-MM
}) {
  const hasta = max ?? mesActualChile()
  const desdeBruto = min ?? sumarMeses(hasta, -12)
  const desde = desdeBruto <= hasta ? desdeBruto : hasta

  const actual = aMes(year, month)
  const acotado = acotarMes(actual, desde, hasta)

  useEffect(() => {
    if (acotado !== actual) {
      const { year: y, month: m } = mesComoNumeros(acotado)
      onChange(y, m)
    }
  }, [acotado, actual, onChange])

  const { year: yearMin, month: monthMin } = mesComoNumeros(desde)
  const { year: yearMax, month: monthMax } = mesComoNumeros(hasta)
  const { year: yearSel } = mesComoNumeros(acotado)

  const years: number[] = []
  for (let y = yearMin; y <= yearMax; y++) years.push(y)

  const primerMes = yearSel === yearMin ? monthMin : 1
  const ultimoMes = yearSel === yearMax ? monthMax : 12
  const meses: number[] = []
  for (let m = primerMes; m <= ultimoMes; m++) meses.push(m)

  function cambiarAnio(nuevoAnio: number) {
    const { year: y, month: m } = mesComoNumeros(acotarMes(aMes(nuevoAnio, month), desde, hasta))
    onChange(y, m)
  }

  const { month: monthSel } = mesComoNumeros(acotado)
  const cls = 'rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-zinc-500 [&>option]:bg-zinc-900'

  return (
    <div className="flex items-center gap-2">
      <select value={monthSel} onChange={(e) => onChange(yearSel, +e.target.value)} className={cls} aria-label="Mes">
        {meses.map((m) => <option key={m} value={m}>{MESES[m - 1]}</option>)}
      </select>
      <select value={yearSel} onChange={(e) => cambiarAnio(+e.target.value)} className={cls} aria-label="Año">
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  )
}
