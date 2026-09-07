'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, AtSign, Check, Clock, UserPlus } from 'lucide-react'
import {
  getTareasDeTriaje,
  completarTriaje,
  posponerTriaje,
  asociarPorInstagram,
  crearLeadYAsociar,
  type TareaTriaje,
} from '@/lib/actions/triage'

/**
 * El aviso de triaje de las agendas nuevas.
 *
 * Una agenda entra sola desde Calendly y nadie se entera hasta que alguien abre
 * la planilla. Esto es lo que fuerza que se mire, y sobre todo lo que fuerza que
 * quede el usuario de Instagram.
 *
 * POR QUE EL INSTAGRAM ES OBLIGATORIO
 * El formulario de Calendly no lo pide, para no agregar fricción justo donde más
 * caro es perder a alguien. Pero sin ese dato la agenda no se puede atribuir a
 * ningún lead, y toda la medición de qué contenido trajo esa llamada se pierde.
 * Se decidió mover ese trabajo al setter, y este popup es donde ocurre.
 *
 * Muestra una sola tarea a la vez, la más urgente. Con cinco agendas nuevas un
 * panel con cinco avisos se cierra sin leer; de a una se resuelve de a una.
 */
export function TriagePopup({ clientId }: { clientId: string }) {
  const [tareas, setTareas] = useState<TareaTriaje[]>([])
  const [trabajando, setTrabajando] = useState(false)
  const [recarga, setRecarga] = useState(0)
  // La hora se toma al cargar y no en cada render: leer el reloj mientras se
  // renderiza haría que el mismo estado se dibuje distinto cada vez.
  const [ahora, setAhora] = useState<number | null>(null)

  const [usuario, setUsuario] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)
  // El usuario que se buscó y no existe. Es lo que habilita crear el lead: sin
  // haber buscado antes, "crear" produciría duplicados del que ya estaba.
  const [noEncontrado, setNoEncontrado] = useState<string | null>(null)

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

  // El popup vive fuera de las pestañas y no se entera de lo que pasa en ellas:
  // borrar la agenda desde la planilla lo dejaba mostrando una tarea que ya no
  // existía. Se vuelve a consultar al volver a la ventana y cada pocos minutos.
  useEffect(() => {
    const refrescar = () => setRecarga(n => n + 1)
    const cada = setInterval(refrescar, 180_000)
    window.addEventListener('focus', refrescar)
    return () => {
      clearInterval(cada)
      window.removeEventListener('focus', refrescar)
    }
  }, [])

  const siguiente = useCallback(() => {
    setUsuario('')
    setAviso(null)
    setNoEncontrado(null)
    setRecarga(n => n + 1)
  }, [])

  const actuar = useCallback(async (accion: () => Promise<void>) => {
    setTrabajando(true)
    try {
      await accion()
      siguiente()
    } finally {
      setTrabajando(false)
    }
  }, [siguiente])

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

  // Lo que falta. Con Instagram y lead ya asociados, el triaje es solo confirmar.
  const faltaInstagram = !tarea.instagram || !tarea.tieneLead

  async function buscar() {
    if (!tarea.agendaRecordId) return
    setTrabajando(true)
    setAviso(null)
    try {
      const r = await asociarPorInstagram(tarea.id, tarea.agendaRecordId, clientId, usuario)
      if (r.estado === 'asociado') {
        siguiente()
      } else if (r.estado === 'sin_lead') {
        setNoEncontrado(r.instagram)
        setAviso(`No existe ningún lead con @${r.instagram}. Puedes crearlo.`)
      } else {
        setAviso('Ese usuario no se entiende. Escribe solo el @usuario.')
      }
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'No se pudo asociar')
    } finally {
      setTrabajando(false)
    }
  }

  async function crear() {
    if (!tarea.agendaRecordId || !noEncontrado) return
    setTrabajando(true)
    try {
      await crearLeadYAsociar(
        tarea.id, tarea.agendaRecordId, clientId, noEncontrado,
        tarea.nombreLead, tarea.emailLead
      )
      siguiente()
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'No se pudo crear el lead')
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <div className="fixed right-4 top-20 z-50 w-[min(380px,calc(100vw-2rem))]">
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
          {tarea.pospuestaVeces > 0 && (
            <p className="text-zinc-600">Pospuesta {tarea.pospuestaVeces} vez(ces)</p>
          )}
        </div>

        {faltaInstagram ? (
          <div className="mt-3 rounded-lg border border-amber-900/40 bg-amber-950/20 p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <AtSign className="h-3.5 w-3.5 text-amber-400" />
              <p className="text-xs font-medium text-amber-300">Falta el usuario de Instagram</p>
            </div>
            <p className="mb-2 text-[11px] leading-relaxed text-zinc-500">
              Sin esto la llamada no se puede atribuir a ningún contenido.
            </p>

            <div className="flex gap-2">
              <input
                value={usuario}
                disabled={trabajando}
                placeholder="@usuario"
                onChange={e => { setUsuario(e.target.value); setNoEncontrado(null); setAviso(null) }}
                onKeyDown={e => { if (e.key === 'Enter') void buscar() }}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-700"
              />
              <button
                disabled={trabajando || usuario.trim().length === 0}
                onClick={() => void buscar()}
                className="shrink-0 rounded-lg bg-amber-950 px-3 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-900 disabled:opacity-40"
              >
                Buscar
              </button>
            </div>

            {aviso && <p className="mt-2 text-[11px] text-zinc-400">{aviso}</p>}

            {noEncontrado && (
              <button
                disabled={trabajando}
                onClick={() => void crear()}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-950 px-3 py-2 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-900 disabled:opacity-50"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Crear lead @{noEncontrado} y asociar
              </button>
            )}
          </div>
        ) : (
          <button
            disabled={trabajando}
            onClick={() => actuar(() => completarTriaje(tarea.id))}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-950 px-3 py-2 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-900 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" /> Revisada
          </button>
        )}

        {/* Posponer sigue existiendo aunque falte el Instagram: si el setter no
            lo tiene a mano, obligarlo a inventar algo sería peor que esperar.
            Queda contado en pospuesta_veces. */}
        <div className="mt-2 flex gap-3 text-[11px] text-zinc-600">
          <button
            disabled={trabajando}
            onClick={() => actuar(() => posponerTriaje(tarea.id, 2))}
            className="flex items-center gap-1 transition-colors hover:text-zinc-400 disabled:opacity-50"
          >
            <Clock className="h-3 w-3" /> En 2 horas
          </button>
          <button
            disabled={trabajando}
            onClick={() => actuar(() => posponerTriaje(tarea.id, 24))}
            className="transition-colors hover:text-zinc-400 disabled:opacity-50"
          >
            Mañana
          </button>
        </div>
      </div>
    </div>
  )
}
