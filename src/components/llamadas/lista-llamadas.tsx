'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Hourglass, Mic, Plus, UserX, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DatosLlamadas, Llamada } from '@/lib/actions/llamadas'
import { coincideFiltro, type FiltroLlamadas } from './formato'
import { LlamadaFila } from './llamada-fila'
import { RegistrarLlamadaModal } from './registrar-llamada-modal'

const TARJETAS: { filtro: Exclude<FiltroLlamadas, 'todas' | 'otro'>; etiqueta: string; icono: typeof CheckCircle2; tono: string }[] = [
  { filtro: 'cerrada', etiqueta: 'Cerradas', icono: CheckCircle2, tono: 'border-emerald-900/50 bg-emerald-950/20 text-emerald-300' },
  { filtro: 'no_cerrada', etiqueta: 'No cerradas', icono: XCircle, tono: 'border-zinc-800 bg-zinc-900/40 text-zinc-300' },
  { filtro: 'no_show', etiqueta: 'No show', icono: UserX, tono: 'border-red-900/40 bg-red-950/20 text-red-300' },
  { filtro: 'pendiente', etiqueta: 'Pendientes de resultado', icono: Hourglass, tono: 'border-amber-900/40 bg-amber-950/20 text-amber-300' },
  { filtro: 'sin_agenda', etiqueta: 'Grabaciones sin agenda', icono: Mic, tono: 'border-blue-900/40 bg-blue-950/20 text-blue-300' },
]

const ETIQUETA_FILTRO: Record<FiltroLlamadas, string> = {
  todas: 'Todas las llamadas',
  cerrada: 'Cerradas',
  no_cerrada: 'No cerradas',
  no_show: 'No show',
  pendiente: 'Pendientes de resultado',
  otro: 'No calificadas y reagendadas',
  sin_agenda: 'Grabaciones sin agenda',
}

/**
 * Tarjetas por resultado y la lista de llamadas. La usan la pestaña del
 * cliente y la página global /calls.
 */
export function ListaLlamadas({
  datos,
  clientId,
  mostrarCliente = false,
  onCambio,
}: {
  datos: DatosLlamadas
  /** Con cliente se puede registrar una llamada; la vista global no. */
  clientId?: string
  mostrarCliente?: boolean
  onCambio: () => void
}) {
  const [filtro, setFiltro] = useState<FiltroLlamadas>('todas')
  const [registrando, setRegistrando] = useState(false)

  const { conteo, agendasSinGrabacion, closers } = useMemo(() => {
    const conteo: Record<FiltroLlamadas, number> = { todas: datos.llamadas.length, cerrada: 0, no_cerrada: 0, no_show: 0, pendiente: 0, otro: 0, sin_agenda: 0 }
    const sinGrabacion: Llamada[] = []
    const nombresCloser = new Set<string>()
    for (const l of datos.llamadas) {
      if (l.origen === 'grabacion_suelta') conteo.sin_agenda++
      else conteo[l.resultado]++
      if (l.origen === 'agenda' && !l.recordingId) sinGrabacion.push(l)
      if (l.closer?.trim()) nombresCloser.add(l.closer.trim())
    }
    return {
      conteo,
      agendasSinGrabacion: sinGrabacion,
      closers: [...nombresCloser].sort((a, b) => a.localeCompare(b, 'es')),
    }
  }, [datos.llamadas])

  const visibles = datos.llamadas.filter((l) => coincideFiltro(l, filtro))

  return (
    <div className="space-y-4">
      {datos.migracionPendiente && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Falta correr la migración 074 en Supabase. Mientras tanto se ven las agendas y los registros antiguos, pero no las grabaciones de Fathom que todavía no tienen agenda.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {TARJETAS.map(({ filtro: f, etiqueta, icono: Icono, tono }) => (
          <button
            key={f}
            onClick={() => setFiltro((actual) => (actual === f ? 'todas' : f))}
            className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-colors hover:brightness-125 ${tono} ${filtro === f ? 'ring-1 ring-zinc-400' : ''}`}
          >
            <Icono className="h-5 w-5 shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{etiqueta}</p>
              <p className="font-mono text-2xl font-semibold text-zinc-50">{conteo[f]}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-400">
          <span>
            {ETIQUETA_FILTRO[filtro]}: {visibles.length} llamada{visibles.length !== 1 ? 's' : ''}
          </span>
          {filtro !== 'todas' && (
            <button onClick={() => setFiltro('todas')} className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline">
              Ver todas
            </button>
          )}
          {filtro === 'todas' && conteo.otro > 0 && (
            <button onClick={() => setFiltro('otro')} className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline">
              {conteo.otro} no calificada{conteo.otro !== 1 ? 's' : ''} o reagendada{conteo.otro !== 1 ? 's' : ''}
            </button>
          )}
        </div>
        {clientId && (
          <Button size="sm" onClick={() => setRegistrando(true)}>
            <Plus className="h-3.5 w-3.5" /> Registrar llamada
          </Button>
        )}
      </div>

      {visibles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Mic className="mb-3 h-8 w-8 text-zinc-700" />
          <p className="text-sm text-zinc-500">Sin llamadas aquí</p>
          <p className="mt-1 text-xs text-zinc-600">
            Las llamadas salen de las agendas que ya ocurrieron.{clientId ? ' Regístrala o elige otro filtro.' : ''}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visibles.map((l) => (
            <LlamadaFila
              key={l.clave}
              llamada={l}
              agendasSinGrabacion={l.clientId ? agendasSinGrabacion.filter((a) => a.clientId === l.clientId) : agendasSinGrabacion}
              mostrarCliente={mostrarCliente}
              onCambio={onCambio}
            />
          ))}
        </div>
      )}

      {registrando && clientId && (
        <RegistrarLlamadaModal
          clientId={clientId}
          hoy={datos.hoy}
          closers={closers}
          onClose={() => setRegistrando(false)}
          onGuardado={onCambio}
        />
      )}
    </div>
  )
}
