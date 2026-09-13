'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bell, FileText, Loader2, UserSearch } from 'lucide-react'
import { getTareasDelCliente, type TareaSistema } from '@/lib/actions/triage'
import { FichaTriajeModal } from './ficha-triaje-modal'
import { AsociarLeadModal } from './asociar-lead-modal'
import { ReporteLlamadaModal } from './reporte-llamada-modal'
import { EVENTO_REFRESCAR, refrescarTareasSistema } from './system-tasks-toast'
import { fechaHora, textoVencimiento, tonoVencimiento } from './formato'

type Fila = TareaSistema & { asignadoNombre: string | null; pospuestaHasta: string | null }

const TIPO: Record<TareaSistema['tipo'], { etiqueta: string; icono: typeof Bell }> = {
  triaje_agenda: { etiqueta: 'Triaje', icono: Bell },
  asociar_lead: { etiqueta: 'Asociar lead', icono: UserSearch },
  reporte_llamada: { etiqueta: 'Aprobar reporte', icono: FileText },
}

/**
 * Las tareas que genera el sistema, en la misma pantalla que las de Notion.
 *
 * Por debajo son dos fuentes (estas viven en Supabase porque tienen plazo,
 * postergación y escalamiento, que Notion no modela), pero el director ve un
 * solo lugar. Aquí aparecen todas, incluidas las pospuestas y las de otros.
 */
export function SystemTasksPanel({ clientId }: { clientId: string }) {
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [ahora, setAhora] = useState<number | null>(null)
  const [abierta, setAbierta] = useState<Fila | null>(null)

  const cargar = useCallback(async () => {
    try {
      setFilas(await getTareasDelCliente(clientId))
      setAhora(Date.now())
    } catch {
      setFilas([])
    }
  }, [clientId])

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 0)
    const alRefrescar = () => void cargar()
    window.addEventListener(EVENTO_REFRESCAR, alRefrescar)
    return () => { clearTimeout(t); window.removeEventListener(EVENTO_REFRESCAR, alRefrescar) }
  }, [cargar])

  const listo = () => { refrescarTareasSistema(); void cargar() }

  if (filas === null) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-600">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando tareas del sistema...
      </div>
    )
  }

  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-zinc-200">Tareas del sistema</h3>
        <span className="text-xs text-zinc-600">
          {filas.length === 0 ? 'Nada pendiente' : `${filas.length} pendiente(s) · triaje, asociar lead y reportes`}
        </span>
      </div>

      {filas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
          <table className="w-full min-w-[720px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02] text-left text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="px-3 py-2 font-semibold">Tarea</th>
                <th className="px-3 py-2 font-semibold">Agenda</th>
                <th className="px-3 py-2 font-semibold">Llamada</th>
                <th className="px-3 py-2 font-semibold">Responsable</th>
                <th className="px-3 py-2 font-semibold">Plazo</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const { etiqueta, icono: Icono } = TIPO[f.tipo]
                const tono = ahora === null ? 'normal' : tonoVencimiento(f.venceAt, ahora)
                return (
                  <tr key={f.id} className={`border-b border-white/[0.04] ${tono === 'vencido' ? 'bg-red-950/15' : ''}`}>
                    <td className="px-3 py-2 text-zinc-300">
                      <Icono className="mr-1.5 inline h-3.5 w-3.5 text-zinc-500" />{etiqueta}
                    </td>
                    <td className="px-3 py-2 text-zinc-100">{f.nombreLead || 'Sin nombre'}</td>
                    <td className="px-3 py-2 text-zinc-400">{fechaHora(f.horaAgenda)}</td>
                    <td className="px-3 py-2 text-zinc-400">{f.asignadoNombre ?? <span className="text-zinc-600">Sin asignar</span>}</td>
                    <td className={`px-3 py-2 font-mono ${tono === 'vencido' ? 'text-red-400' : tono === 'urgente' ? 'text-amber-400' : 'text-zinc-500'}`}>
                      {ahora !== null ? textoVencimiento(f.venceAt, ahora) : ''}
                      {f.pospuestaVeces > 0 && <span className="ml-2 text-zinc-600">pospuesta {f.pospuestaVeces}×</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => setAbierta(f)} disabled={!f.agendaId}
                        className="rounded-md border border-white/[0.1] px-2 py-1 text-[11px] text-zinc-300 hover:bg-white/[0.06] disabled:opacity-40">
                        Abrir
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {abierta?.agendaId && abierta.tipo === 'triaje_agenda' && (
        <FichaTriajeModal agendaId={abierta.agendaId} onClose={() => setAbierta(null)} onGuardada={listo}
          onAsociarLead={() => setAbierta({ ...abierta, tipo: 'asociar_lead' })} />
      )}
      {abierta?.agendaId && abierta.tipo === 'asociar_lead' && (
        <AsociarLeadModal agendaId={abierta.agendaId} nombreLead={abierta.nombreLead} onClose={() => setAbierta(null)} onListo={listo} />
      )}
      {abierta?.agendaId && abierta.tipo === 'reporte_llamada' && (
        <ReporteLlamadaModal agendaId={abierta.agendaId} onClose={() => setAbierta(null)} onAprobado={listo} />
      )}
    </section>
  )
}
