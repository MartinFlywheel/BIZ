'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink, FileText, Link2, Loader2, Unlink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ReporteLlamadaModal } from '@/components/pipeline/reporte-llamada-modal'
import { ESTADOS_REPORTE } from '@/lib/pipeline-tipos'
import {
  asociarGrabacion,
  cambiarEstadoLlamada,
  desasociarGrabacion,
  type Llamada,
} from '@/lib/actions/llamadas'
import { fechaCorta, fechaLlamada, RESULTADO_BADGE, resumenLegible } from './formato'

const ESTADOS = ['Pendiente', ...ESTADOS_REPORTE]

function diasEntre(a: string | null, b: string | null): number {
  if (!a || !b) return 999
  return Math.abs(Math.round((Date.parse(`${a.slice(0, 10)}T12:00:00Z`) - Date.parse(`${b.slice(0, 10)}T12:00:00Z`)) / 86_400_000))
}

function etiquetaReporte(estado: string | null): string {
  if (estado === 'aprobado') return 'Reporte aprobado'
  if (estado === 'borrador') return 'Revisar borrador'
  return 'Reporte'
}

/**
 * Una llamada de la lista.
 *
 * "Ver grabación" está siempre a la vista: antes el enlace a Fathom aparecía
 * solo al pasar el mouse, y en el celular no se veía nunca.
 */
export function LlamadaFila({
  llamada,
  agendasSinGrabacion,
  mostrarCliente = false,
  onCambio,
}: {
  llamada: Llamada
  /** Agendas del mismo cliente sin grabación, para el selector "Asociar a agenda". */
  agendasSinGrabacion: Llamada[]
  mostrarCliente?: boolean
  onCambio: () => void
}) {
  const [verResumen, setVerResumen] = useState(false)
  const [reporteAbierto, setReporteAbierto] = useState(false)
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [agendaElegida, setAgendaElegida] = useState(llamada.sugerencia?.agendaId ?? '')

  const badge = RESULTADO_BADGE[llamada.resultado]
  const fechaGrabacion = llamada.cuando

  async function ejecutar(accion: () => Promise<{ ok: boolean; error?: string }>) {
    setTrabajando(true)
    setError(null)
    try {
      const r = await accion()
      if (!r.ok) { setError(r.error ?? 'No se pudo guardar.'); return }
      onCambio()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setTrabajando(false)
    }
  }

  // Opciones para asociar: la sugerida primero, después las agendas sin
  // grabación más cercanas en fecha (una semana hacia cada lado).
  const opciones = llamada.origen === 'grabacion_suelta'
    ? agendasSinGrabacion
        .filter((a) => a.agendaId && a.agendaId !== llamada.sugerencia?.agendaId && diasEntre(a.cuando, fechaGrabacion) <= 7)
        .sort((a, b) => diasEntre(a.cuando, fechaGrabacion) - diasEntre(b.cuando, fechaGrabacion))
        .slice(0, 15)
    : []

  return (
    <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/30 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-xs text-zinc-500 sm:w-44 sm:shrink-0">{fechaLlamada(llamada)}</span>
        <span className="text-sm font-medium text-zinc-100">{llamada.nombre || 'Sin nombre'}</span>
        {llamada.origen === 'grabacion_suelta' ? (
          <Badge variant="info">Grabación sin agenda</Badge>
        ) : (
          <Badge variant={badge.variante}>{llamada.resultado === 'otro' && llamada.estado ? llamada.estado : badge.etiqueta}</Badge>
        )}
        {llamada.origen === 'legado' && (
          <span className="rounded border border-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500" title="Llamada registrada a mano antes de que las llamadas vivieran en las agendas">
            Registro antiguo
          </span>
        )}
        {mostrarCliente && llamada.clienteNombre && (
          <span className="text-[11px] text-zinc-500">· {llamada.clienteNombre}</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {llamada.grabacionUrl ? (
            <a
              href={llamada.grabacionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Ver grabación
            </a>
          ) : (
            <span className="text-[11px] text-zinc-600">Sin grabación</span>
          )}
        </div>
      </div>

      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-zinc-500">
        {llamada.closer && <span>Closer: <span className="text-zinc-300">{llamada.closer}</span></span>}
        {llamada.setter && <span>Setter: <span className="text-zinc-300">{llamada.setter}</span></span>}
        {llamada.duracionMin !== null && <span>Duración: <span className="text-zinc-300">{llamada.duracionMin} min</span></span>}
        {llamada.grabadoPor && <span>Grabó: <span className="text-zinc-300">{llamada.grabadoPor}</span></span>}
        {llamada.origen === 'agenda' && llamada.reporteEstado && (
          <span>Reporte: <span className="text-zinc-300">{llamada.reporteEstado === 'aprobado' ? 'aprobado' : 'borrador'}</span></span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {llamada.resumen && (
          <button
            onClick={() => setVerResumen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
          >
            {verResumen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {verResumen ? 'Ocultar resumen' : llamada.origen === 'legado' ? 'Ver notas' : 'Ver resumen de Fathom'}
          </button>
        )}

        {llamada.origen === 'agenda' && llamada.agendaId && (
          <>
            <select
              value={ESTADOS.includes(llamada.estado ?? '') ? llamada.estado ?? 'Pendiente' : 'Pendiente'}
              disabled={trabajando}
              onChange={(e) => ejecutar(() => cambiarEstadoLlamada(llamada.agendaId!, e.target.value))}
              className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 focus:outline-none [&>option]:bg-zinc-900"
              aria-label="Resultado de la llamada"
            >
              {ESTADOS.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
            <button
              onClick={() => setReporteAbierto(true)}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-white/[0.04]"
            >
              <FileText className="h-3.5 w-3.5" /> {etiquetaReporte(llamada.reporteEstado)}
            </button>
            {llamada.recordingId && (
              <button
                disabled={trabajando}
                onClick={() => {
                  if (!confirm('¿Desasociar la grabación de esta agenda? Vuelve a la lista de grabaciones sin agenda y el borrador del reporte se descarta si no estaba aprobado.')) return
                  ejecutar(() => desasociarGrabacion(llamada.recordingId!))
                }}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300"
              >
                <Unlink className="h-3.5 w-3.5" /> Desasociar grabación
              </button>
            )}
          </>
        )}

        {llamada.origen === 'grabacion_suelta' && llamada.recordingId && (
          <>
            <select
              value={agendaElegida}
              disabled={trabajando}
              onChange={(e) => setAgendaElegida(e.target.value)}
              className="max-w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 focus:outline-none [&>option]:bg-zinc-900"
              aria-label="Agenda a la que asociar la grabación"
            >
              <option value="">Asociar a agenda...</option>
              {llamada.sugerencia && (
                <option value={llamada.sugerencia.agendaId}>
                  Sugerida: {llamada.sugerencia.nombre || 'sin nombre'} · {fechaCorta(llamada.sugerencia.fecha)}
                  {llamada.sugerencia.puntaje !== null ? ` (${llamada.sugerencia.puntaje} pts)` : ''}
                </option>
              )}
              {opciones.map((a) => (
                <option key={a.agendaId} value={a.agendaId!}>
                  {a.nombre || 'Sin nombre'} · {fechaCorta(a.cuando)}{a.closer ? ` · ${a.closer}` : ''}
                </option>
              ))}
            </select>
            <button
              disabled={trabajando || !agendaElegida}
              onClick={() => ejecutar(() => asociarGrabacion(llamada.recordingId!, agendaElegida))}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-white/[0.04] disabled:opacity-40"
            >
              {trabajando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
              Asociar
            </button>
          </>
        )}

        {trabajando && llamada.origen === 'agenda' && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" />}
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {verResumen && llamada.resumen && (
        <div className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-xs leading-relaxed text-zinc-400">
          {resumenLegible(llamada.resumen)}
        </div>
      )}

      {reporteAbierto && llamada.agendaId && (
        <ReporteLlamadaModal
          agendaId={llamada.agendaId}
          onClose={() => setReporteAbierto(false)}
          onAprobado={onCambio}
        />
      )}
    </div>
  )
}
