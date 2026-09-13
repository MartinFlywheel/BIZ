'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { getPanelMarketing, type FilaMarketing } from '@/lib/actions/triage'
import { EVENTO_REFRESCAR } from './system-tasks-toast'

const PERIODOS = [30, 60, 90] as const

function pct(parte: number, total: number): string {
  return total > 0 ? `${Math.round((parte / total) * 100)}%` : '—'
}

/**
 * Lo que recibe marketing de las llamadas.
 *
 * Calidad de lead por origen (lo que dijo la ficha de triaje), cierre por
 * origen (lo que pasó en la llamada) y las objeciones y aportes de los reportes
 * aprobados. El cruce sale de «de dónde vino» de cada agenda.
 */
export function PanelMarketingLlamadas({ clientId }: { clientId: string }) {
  const [dias, setDias] = useState<(typeof PERIODOS)[number]>(60)
  const [filas, setFilas] = useState<FilaMarketing[] | null>(null)
  const [sinMigracion, setSinMigracion] = useState(false)
  const [abierto, setAbierto] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    const cargar = () => {
      getPanelMarketing(clientId, dias)
        .then((r) => { if (vigente) { setFilas(r.filas); setSinMigracion(r.sinMigracion) } })
        .catch(() => { if (vigente) setFilas([]) })
    }
    cargar()
    window.addEventListener(EVENTO_REFRESCAR, cargar)
    return () => { vigente = false; window.removeEventListener(EVENTO_REFRESCAR, cargar) }
  }, [clientId, dias])

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h3 className="text-sm font-semibold text-zinc-200">Lo que recibe marketing</h3>
        <span className="text-xs text-zinc-600">Calidad y cierre por origen · objeciones de reportes aprobados</span>
        <div className="ml-auto flex gap-1">
          {PERIODOS.map((p) => (
            <button key={p} onClick={() => setDias(p)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                dias === p ? 'border-rose-800/60 bg-rose-950/40 text-rose-200' : 'border-white/[0.08] text-zinc-500 hover:text-zinc-300'
              }`}>
              {p} días
            </button>
          ))}
        </div>
      </div>

      {filas === null ? (
        <div className="flex items-center gap-2 text-xs text-zinc-600"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando...</div>
      ) : sinMigracion ? (
        <p className="rounded-lg border border-dashed border-zinc-800 p-3 text-xs text-zinc-500">
          Falta correr la migración 070 en Supabase para ver este panel.
        </p>
      ) : filas.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-800 p-3 text-xs text-zinc-500">Sin agendas en el período.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
          <table className="w-full min-w-[820px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02] text-left text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="px-3 py-2 font-semibold">Origen</th>
                <th className="px-3 py-2 text-right font-semibold">Agendas</th>
                <th className="px-3 py-2 text-right font-semibold" title="Sobre las agendas con ficha de triaje">Califican</th>
                <th className="px-3 py-2 text-right font-semibold" title="Sobre las agendas con ficha de triaje">Calientes</th>
                <th className="px-3 py-2 text-right font-semibold">Show</th>
                <th className="px-3 py-2 text-right font-semibold">Cierre</th>
                <th className="px-3 py-2 font-semibold">Objeciones y aportes</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const textos = [...f.objeciones.map((o) => ({ tipo: 'Objeción', t: o })), ...f.aportes.map((a) => ({ tipo: 'Aporte', t: a }))]
                return (
                  <tr key={f.origen} className="border-b border-white/[0.04] align-top">
                    <td className="px-3 py-2 font-medium text-zinc-100">{f.origen}</td>
                    <td className="px-3 py-2 text-right font-mono text-zinc-300">{f.agendas}</td>
                    <td className="px-3 py-2 text-right font-mono text-zinc-300" title={`${f.conFicha} con ficha · ${f.dudosos} dudosos · ${f.noCalifican} no`}>
                      {f.conFicha > 0 ? pct(f.califican, f.conFicha) : <span className="text-zinc-600">sin fichas</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-zinc-300">{f.conFicha > 0 ? pct(f.calientes, f.conFicha) : '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-zinc-300">{pct(f.shows, f.agendas)}</td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-400">{pct(f.cierres, f.shows)}</td>
                    <td className="px-3 py-2 text-zinc-400">
                      {textos.length === 0 ? (
                        <span className="text-zinc-600">
                          {f.reportesAprobados === 0 ? 'Sin reportes aprobados' : 'Reportes sin objeción ni aporte'}
                        </span>
                      ) : (
                        <button onClick={() => setAbierto(abierto === f.origen ? null : f.origen)}
                          className="flex items-center gap-1 text-left text-zinc-300 hover:text-zinc-100">
                          <ChevronDown className={`h-3 w-3 transition-transform ${abierto === f.origen ? 'rotate-180' : ''}`} />
                          {f.objeciones.length} objeción(es) · {f.aportes.length} aporte(s)
                        </button>
                      )}
                      {abierto === f.origen && (
                        <ul className="mt-2 max-w-xl space-y-1.5">
                          {textos.map((x, i) => (
                            <li key={i}><span className="text-[10px] uppercase tracking-wide text-zinc-600">{x.tipo} · </span>{x.t}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
