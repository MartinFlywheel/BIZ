import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

/**
 * Selector de mes para la app móvil.
 *
 * Flechas y no un `<select>`: en el celular cambiar de mes casi siempre es ir
 * al anterior o al siguiente, y un desplegable nativo obliga a abrir una hoja
 * a pantalla completa para lo que aquí es un toque. Son enlaces, así que la
 * página sigue siendo un componente de servidor y no hay JavaScript de por
 * medio.
 */
export function MonthNav({
  basePath,
  year,
  month,
  clientId,
  total,
}: {
  basePath: string
  year: number
  month: number
  clientId?: string | null
  total?: number
}) {
  function href(y: number, m: number): string {
    const params = new URLSearchParams()
    if (clientId) params.set('client', clientId)
    params.set('y', String(y))
    params.set('m', String(m))
    return `${basePath}?${params.toString()}`
  }

  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 }
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 }

  const hoy = new Date()
  const esMesActual = year === hoy.getFullYear() && month === hoy.getMonth() + 1

  return (
    <div className="flex items-center gap-2 px-4 pb-3">
      <Link
        href={href(prev.y, prev.m)}
        aria-label="Mes anterior"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-zinc-400 active:bg-white/[0.09]"
      >
        <ChevronLeft className="h-4 w-4" />
      </Link>

      <div className="flex-1 text-center">
        <p className="text-sm font-medium text-zinc-200">
          {MESES[month - 1]} {year}
        </p>
        {total !== undefined && (
          <p className="text-xs text-zinc-500">
            {total} llamada{total === 1 ? '' : 's'}
          </p>
        )}
      </div>

      <Link
        href={href(next.y, next.m)}
        aria-label="Mes siguiente"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-zinc-400 active:bg-white/[0.09]"
      >
        <ChevronRight className="h-4 w-4" />
      </Link>

      {/* Volver al mes actual con un toque, sin tener que contar meses hacia
          atrás cuando uno se fue lejos mirando histórico. */}
      {!esMesActual && (
        <Link
          href={href(hoy.getFullYear(), hoy.getMonth() + 1)}
          className="shrink-0 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs font-medium text-zinc-300 active:bg-white/[0.09]"
        >
          Hoy
        </Link>
      )}
    </div>
  )
}
