'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Check, Clock, X } from 'lucide-react'
import {
  getTareasDeTriaje,
  completarTriaje,
  posponerTriaje,
  type TareaTriaje,
} from '@/lib/actions/triage'

/**
 * El aviso de triaje de las agendas nuevas.
 *
 * Una agenda entra sola desde Calendly y nadie se entera hasta que alguien abre
 * la planilla. Esto es lo que fuerza que se mire: aparece arriba a la derecha y
 * no se va sin que se decida algo.
 *
 * Muestra una sola tarea a la vez, la más urgente. Con cinco agendas nuevas un
 * panel con cinco avisos se cierra sin leer; de a una se resuelve de a una.
 *
 * No hay botón de cerrar sin decidir, a propósito: posponer es el "después", y
 * queda registrado. Cerrar y olvidar es justo lo que pasaba antes.
 */
export function TriagePopup({ clientId }: { clientId: string }) {
  const [tareas, setTareas] = useState<TareaTriaje[]>([])
  const [trabajando, setTrabajando] = useState(false)
  const [recarga, setRecarga] = useState(0)
  // La hora se toma al cargar y no en cada render: leer el reloj mientras se
  // renderiza haría que el mismo estado se dibuje distinto cada vez.
  const [ahora, setAhora] = useState<number | null>(null)

  useEffect(() => {
    let vigente = true
    void (async () => {
      try {
        const t = await getTareasDeTriaje(clientId)
        if (vigente) {
          setTareas(t)
          setAhora(Date.now())
        }
      } catch {
        // Sin la migración 053 esto no existe todavía. El panel sigue igual.
        if (vigente) setTareas([])
      }
    })()
    return () => { vigente = false }
  }, [clientId, recarga])

  const actuar = useCallback(async (accion: () => Promise<void>) => {
    setTrabajando(true)
    try {
      await accion()
      setRecarga(n => n + 1)
    } finally {
      setTrabajando(false)
    }
  }, [])

  const tarea = tareas[0]
  if (!tarea) return null

  const atrasada = ahora !== null && tarea.venceAt
    ? new Date(tarea.venceAt).getTime() < ahora
    : false
  const cuando = tarea.horaAgenda
    ? new Date(tarea.horaAgenda).toLocaleString('es-CL', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      })
    : null

  return (
    <div className="fixed right-4 top-20 z-50 w-[min(360px,calc(100vw-2rem))]">
      <div
        className={`rounded-xl border bg-zinc-950/95 p-4 shadow-2xl backdrop-blur ${
          atrasada ? 'border-red-900/60' : 'border-zinc-800'
        }`}
      >
        <div className="mb-2 flex items-center gap-2">
          <AlertCircle className={`h-4 w-4 ${atrasada ? 'text-red-400' : 'text-amber-400'}`} />
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            {atrasada ? 'Triaje atrasado' : 'Agenda por revisar'}
          </p>
          {tareas.length > 1 && (
            <span className="ml-auto text-xs text-zinc-600">+{tareas.length - 1} más</span>
          )}
        </div>

        <p className="text-sm font-semibold text-zinc-100">
          {tarea.nombreLead || 'Reserva sin nombre'}
        </p>

        <div className="mt-1 space-y-0.5 text-xs text-zinc-500">
          {cuando && <p>Llamada el {cuando}</p>}
          {tarea.emailLead && <p className="break-all">{tarea.emailLead}</p>}
          <p className={tarea.tieneLead ? 'text-emerald-500' : 'text-amber-500'}>
            {tarea.tieneLead ? 'Lead asociado' : 'Sin lead asociado — hay que buscarlo'}
          </p>
          {tarea.pospuestaVeces > 0 && (
            <p className="text-zinc-600">Pospuesta {tarea.pospuestaVeces} vez(ces)</p>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <button
            disabled={trabajando}
            onClick={() => actuar(() => completarTriaje(tarea.id))}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-950 px-3 py-2 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-900 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" /> Revisada
          </button>
          <button
            disabled={trabajando}
            onClick={() => actuar(() => posponerTriaje(tarea.id, 2))}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-400 transition-colors hover:text-zinc-100 disabled:opacity-50"
          >
            <Clock className="h-3.5 w-3.5" /> En 2 horas
          </button>
        </div>

        <button
          disabled={trabajando}
          onClick={() => actuar(() => posponerTriaje(tarea.id, 24))}
          className="mt-2 flex w-full items-center justify-center gap-1.5 text-[11px] text-zinc-600 transition-colors hover:text-zinc-400 disabled:opacity-50"
        >
          <X className="h-3 w-3" /> Posponer un día
        </button>
      </div>
    </div>
  )
}
