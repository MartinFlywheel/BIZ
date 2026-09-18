'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarRange } from 'lucide-react'
import { hoyChile, sumarDias } from '@/lib/fecha-chile'

const OPTIONS: { value: string; label: string }[] = [
  { value: 'weekly', label: 'Semana' },
  { value: '15d', label: '15 días' },
  { value: '30d', label: '30 días' },
  { value: 'monthly', label: 'Mes' },
]

/**
 * Período del funnel. Además de los fijos, "Personalizado" abre dos fechas
 * (desde / hasta) que viajan en la URL como ?period=custom&desde=&hasta=, así
 * que el rango se puede compartir o recargar igual que los demás.
 */
export function PeriodToggle({ selected, desde, hasta }: { selected?: string; desde?: string; hasta?: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const hoy = hoyChile().iso
  const [abierto, setAbierto] = useState(selected === 'custom')
  const [inicio, setInicio] = useState(desde ?? sumarDias(hoy, -13))
  const [fin, setFin] = useState(hasta ?? hoy)

  function irA(cambios: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(cambios)) {
      if (v === null) params.delete(k)
      else params.set(k, v)
    }
    router.push(`/dashboard?${params.toString()}`)
  }

  function handleSelect(value: string) {
    setAbierto(false)
    irA({ period: value === 'weekly' ? null : value, desde: null, hasta: null })
  }

  const rangoValido = !!inicio && !!fin && inicio <= fin

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-1">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handleSelect(opt.value)}
            className={`rounded-md px-3 h-7 text-xs font-medium transition-colors ${
              !abierto && (selected || 'weekly') === opt.value
                ? 'bg-white/[0.1] text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <button
          onClick={() => setAbierto(true)}
          className={`flex items-center gap-1.5 rounded-md px-3 h-7 text-xs font-medium transition-colors ${
            abierto ? 'bg-white/[0.1] text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <CalendarRange className="h-3.5 w-3.5" /> Personalizado
        </button>
      </div>

      {abierto && (
        <form
          className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-1"
          onSubmit={(e) => {
            e.preventDefault()
            if (rangoValido) irA({ period: 'custom', desde: inicio, hasta: fin })
          }}
        >
          <input
            type="date"
            value={inicio}
            max={fin || hoy}
            onChange={(e) => setInicio(e.target.value)}
            aria-label="Desde"
            className="h-7 rounded-md bg-transparent px-2 text-xs text-zinc-200 [color-scheme:dark]"
          />
          <span className="text-xs text-zinc-600">a</span>
          <input
            type="date"
            value={fin}
            min={inicio}
            max={hoy}
            onChange={(e) => setFin(e.target.value)}
            aria-label="Hasta"
            className="h-7 rounded-md bg-transparent px-2 text-xs text-zinc-200 [color-scheme:dark]"
          />
          <button
            type="submit"
            disabled={!rangoValido}
            className="h-7 rounded-md bg-white/[0.1] px-3 text-xs font-medium text-zinc-100 hover:bg-white/[0.15] disabled:opacity-40"
          >
            Aplicar
          </button>
        </form>
      )}
    </div>
  )
}
