'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, Calendar, Clock, FileText, Lock, UserSearch } from 'lucide-react'
import {
  getResponsables,
  posponerTarea,
  reasignarTarea,
  type Responsable,
  type TareaSistema,
} from '@/lib/actions/triage'
import { FichaTriajeModal } from './ficha-triaje-modal'
import { AsociarLeadModal } from './asociar-lead-modal'
import { ReporteLlamadaModal } from './reporte-llamada-modal'
import { fechaHora, textoVencimiento, tonoVencimiento } from './formato'

/** Lo dispara cualquier pantalla que cierre una tarea, para que el popup no quede atrasado. */
export const EVENTO_REFRESCAR = 'pipeline:refrescar'

export function refrescarTareasSistema() {
  window.dispatchEvent(new Event(EVENTO_REFRESCAR))
}

const TITULOS: Record<TareaSistema['tipo'], { titulo: string; boton: string }> = {
  triaje_agenda: { titulo: 'Hacer triaje', boton: 'Hacer triaje' },
  asociar_lead: { titulo: 'Asociar lead', boton: 'Asociar lead' },
  reporte_llamada: { titulo: 'Aprobar reporte', boton: 'Revisar reporte' },
}

/**
 * El aviso de tareas del Pipeline de Agendas.
 *
 * Es chrome global: vive en el layout, no en una página, así que aparece en
 * cualquier pantalla del CRM. Muestra una tarea a la vez con el total («1 de 3»):
 * cinco popups se cierran sin leer, uno se resuelve.
 *
 * No tiene botón de cerrar a propósito. Se sale decidiendo algo: hacerla,
 * posponerla dentro de lo que el plazo permite o, si venció, reasignarla. El
 * estado vive en la base (visible_desde), no en el navegador, así que cambiar
 * de equipo no reinicia nada.
 *
 * Refresca cada 45 segundos y al volver a la ventana. Si el navegador lo
 * permite, lo vencido y lo nuevo también llegan como notificación del sistema
 * operativo, para cuando el CRM está en otra pestaña.
 */
export function SystemTasksToast() {
  const [tareas, setTareas] = useState<TareaSistema[]>([])
  const [ahora, setAhora] = useState<number | null>(null)
  const [verPosponer, setVerPosponer] = useState(false)
  const [responsables, setResponsables] = useState<Responsable[] | null>(null)
  const [abierta, setAbierta] = useState<TareaSistema | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [permiso, setPermiso] = useState<NotificationPermission | 'no-soportado'>('no-soportado')
  const vistas = useRef<Map<string, string>>(new Map())
  const enCurso = useRef(false)
  const repetir = useRef(false)
  const cajaRef = useRef<HTMLDivElement>(null)
  const arrastre = useRef<{ px: number; py: number; x: number; y: number; rect: DOMRect } | null>(null)
  const [desplazamiento, setDesplazamiento] = useState({ x: 0, y: 0 })

  // El aviso no se puede cerrar: si al achicar la ventana queda fuera de la
  // pantalla, se vuelve a meter dentro.
  useEffect(() => {
    const alRedimensionar = () => {
      const caja = cajaRef.current
      if (caja) setDesplazamiento((d) => acotar(d.x, d.y, caja.getBoundingClientRect(), d))
    }
    window.addEventListener('resize', alRedimensionar)
    return () => window.removeEventListener('resize', alRedimensionar)
  }, [])

  // Por fetch a un route handler y no con la server action getMisTareas: Next
  // despacha las server actions del navegador de a una, y este sondeo cada 45
  // segundos (más cada vuelta a la ventana) hacía esperar a la pestaña que el
  // usuario estaba abriendo. Las escrituras (posponer, reasignar) siguen como
  // server actions.
  const cargar = useCallback(async () => {
    // Una consulta a la vez. Si se pide otra mientras una está en vuelo (por
    // ejemplo, justo después de posponer), se repite al terminar: la que ya
    // iba pudo leer la base antes del cambio y devolvería la tarea pospuesta.
    if (enCurso.current) {
      repetir.current = true
      return
    }
    enCurso.current = true
    try {
      do {
        repetir.current = false
        try {
          const res = await fetch('/api/tareas/mias', { cache: 'no-store' })
          if (!res.ok) continue
          const t = (await res.json()) as TareaSistema[]
          if (repetir.current) continue
          setTareas(t)
          const momento = Date.now()
          setAhora(momento)
          avisarAlSistema(t, momento, vistas.current)
        } catch {
          // Una vuelta fallida no borra lo que ya se mostraba.
        }
      } while (repetir.current)
    } finally {
      enCurso.current = false
    }
  }, [])

  useEffect(() => {
    // Con la pestaña oculta no se consulta: nadie ve el aviso. La excepción es
    // cuando hay permiso de notificaciones del sistema, que existen justamente
    // para avisar de lo nuevo y lo vencido mientras el CRM está en otra pestaña.
    const vale = () =>
      document.visibilityState !== 'hidden' ||
      (typeof Notification !== 'undefined' && Notification.permission === 'granted')

    // La primera carga va en un timeout para no escribir estado dentro del
    // cuerpo del efecto.
    const inicial = setTimeout(() => {
      void cargar()
      if (typeof Notification !== 'undefined') setPermiso(Notification.permission)
    }, 0)
    const cada = setInterval(() => { if (vale()) void cargar() }, 45_000)
    const reloj = setInterval(() => setAhora(Date.now()), 30_000)

    // Volver a la ventana dispara focus y visibilitychange casi juntos, y
    // cambiar de ventana varias veces seguidas los repite: con el debounce sale
    // una sola consulta.
    let espera: ReturnType<typeof setTimeout> | null = null
    const alVolver = () => {
      if (espera) clearTimeout(espera)
      espera = setTimeout(() => {
        espera = null
        if (document.visibilityState !== 'hidden') void cargar()
      }, 600)
    }
    // Cuando otra pantalla cierra una tarea, el aviso se actualiza en el acto.
    const alRefrescar = () => void cargar()

    window.addEventListener('focus', alVolver)
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener(EVENTO_REFRESCAR, alRefrescar)
    return () => {
      clearTimeout(inicial)
      if (espera) clearTimeout(espera)
      clearInterval(cada)
      clearInterval(reloj)
      window.removeEventListener('focus', alVolver)
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener(EVENTO_REFRESCAR, alRefrescar)
    }
  }, [cargar])

  const tarea = tareas[0]

  // Si la tarea de arriba cambió (se cerró en otra pestaña, llegó una más
  // urgente), lo que estaba abierto era de la anterior: posponer o reasignar
  // desde ahí actuaría sobre la tarea equivocada.
  const [tareaVista, setTareaVista] = useState<string | undefined>(undefined)
  if (tareaVista !== tarea?.id) {
    setTareaVista(tarea?.id)
    setVerPosponer(false)
    setResponsables(null)
    setAviso(null)
  }

  const despues = useCallback(() => {
    setVerPosponer(false)
    setResponsables(null)
    setAviso(null)
    // Por evento y no llamando a cargar(): así también se enteran la planilla
    // de agendas y la pantalla de Tareas si están abiertas.
    refrescarTareasSistema()
  }, [])

  if (!tarea && !abierta) return null

  const modal = abierta && abierta.agendaId ? (
    abierta.tipo === 'triaje_agenda' ? (
      <FichaTriajeModal
        agendaId={abierta.agendaId}
        onClose={() => setAbierta(null)}
        onGuardada={despues}
        onAsociarLead={() => setAbierta({ ...abierta, tipo: 'asociar_lead' })}
      />
    ) : abierta.tipo === 'asociar_lead' ? (
      <AsociarLeadModal
        agendaId={abierta.agendaId}
        nombreLead={abierta.nombreLead}
        onClose={() => setAbierta(null)}
        onListo={despues}
      />
    ) : (
      <ReporteLlamadaModal agendaId={abierta.agendaId} onClose={() => setAbierta(null)} onAprobado={despues} />
    )
  ) : null

  if (!tarea) return modal

  const tono = ahora === null ? 'normal' : tonoVencimiento(tarea.venceAt, ahora)
  const bloqueada = tarea.opcionesPosponer.length === 0
  const { titulo, boton } = TITULOS[tarea.tipo]
  const Icono = tarea.tipo === 'reporte_llamada' ? FileText : tarea.tipo === 'asociar_lead' ? UserSearch : Bell

  async function posponer(etiqueta: string) {
    setTrabajando(true)
    try {
      const r = await posponerTarea(tarea.id, etiqueta)
      if (!r.ok) { setAviso(r.error ?? 'No se pudo posponer'); void cargar(); return }
      // Se saca en el acto: esperar la recarga dejaba el aviso visible un rato
      // y parecía que posponer no había hecho nada.
      setTareas((prev) => prev.filter((t) => t.id !== tarea.id))
      despues()
    } catch {
      setAviso('No se pudo posponer. Revisa tu sesión e inténtalo de nuevo.')
    } finally {
      setTrabajando(false)
    }
  }

  async function abrirReasignar() {
    setAviso(null)
    try {
      const lista = await getResponsables(tarea.clientId)
      if (lista.length === 0) setAviso('No hay a quién reasignar en este cliente.')
      else setResponsables(lista)
    } catch {
      setAviso('No se pudo cargar la lista. Revisa tu sesión e inténtalo de nuevo.')
    }
  }

  async function reasignar(userId: string) {
    setTrabajando(true)
    try {
      const r = await reasignarTarea(tarea.id, userId)
      if (!r.ok) { setAviso(r.error ?? 'No se pudo reasignar'); return }
      if (userId !== tarea.asignadoA) setTareas((prev) => prev.filter((t) => t.id !== tarea.id))
      despues()
    } catch {
      setAviso('No se pudo reasignar. Revisa tu sesión e inténtalo de nuevo.')
    } finally {
      setTrabajando(false)
    }
  }

  const borde = tono === 'vencido'
    ? 'border-red-400/45 shadow-[0_0_0_1px_rgba(248,113,113,0.14)]'
    : tono === 'urgente' ? 'border-amber-400/40' : 'border-white/[0.11]'
  const colorIcono = tono === 'vencido'
    ? 'border-red-400/35 bg-red-400/10 text-red-400'
    : tono === 'urgente' ? 'border-amber-400/35 bg-amber-400/10 text-amber-400' : 'border-rose-900/50 bg-rose-950/40 text-rose-300'

  return (
    <>
      <div
        ref={cajaRef}
        className="fixed right-4 top-4 z-[90] w-[min(360px,calc(100vw-2rem))] sm:right-6 sm:top-6"
        style={{ transform: `translate(${desplazamiento.x}px, ${desplazamiento.y}px)` }}
      >
        <div className={`rounded-2xl border bg-[#141415]/95 p-4 shadow-2xl backdrop-blur-xl ${borde}`}>
          <div
            title="Arrastra para mover"
            className="mb-3 flex cursor-grab touch-none select-none items-center gap-2.5 active:cursor-grabbing"
            onPointerDown={(e) => {
              if (e.button !== 0 || !cajaRef.current) return
              e.currentTarget.setPointerCapture(e.pointerId)
              arrastre.current = {
                px: e.clientX,
                py: e.clientY,
                ...desplazamiento,
                rect: cajaRef.current.getBoundingClientRect(),
              }
            }}
            onPointerMove={(e) => {
              const a = arrastre.current
              if (a) setDesplazamiento(acotar(a.x + e.clientX - a.px, a.y + e.clientY - a.py, a.rect, a))
            }}
            onPointerUp={() => { arrastre.current = null }}
            onPointerCancel={() => { arrastre.current = null }}
          >
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${colorIcono}`}>
              <Icono className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.11em] text-zinc-500">
                {tono === 'vencido' ? 'Vencido' : tono === 'urgente' ? 'Vence pronto' : 'Tarea pendiente'}
                {tarea.clientName ? ` · ${tarea.clientName}` : ''}
              </p>
              <p className="text-[13.5px] font-semibold text-zinc-100">
                {tono === 'vencido' && tarea.tipo === 'triaje_agenda' ? 'Triaje sin hacer' : titulo}
              </p>
            </div>
            <span className="ml-auto rounded-md border border-white/[0.11] px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
              1 de {tareas.length}
            </span>
          </div>

          <div className="rounded-xl border border-white/[0.06] bg-white/[0.035] p-3">
            <p className="text-[13.5px] font-semibold text-zinc-100">{tarea.nombreLead || 'Reserva sin nombre'}</p>
            <p className="font-mono text-[11px] text-zinc-500">
              {tarea.instagram ? `@${tarea.instagram}` : tarea.tieneLead ? 'lead asociado' : 'sin lead asociado'}
            </p>
          </div>

          <div className="mt-2.5 flex items-center gap-1.5 text-xs text-zinc-400">
            <Calendar className="h-3.5 w-3.5 text-zinc-600" />
            <span>Llamada <b className="font-semibold text-zinc-200">{fechaHora(tarea.horaAgenda)}</b></span>
            {ahora !== null && tarea.venceAt && (
              <span className={`ml-auto font-mono text-[11px] ${
                tono === 'vencido' ? 'text-red-400' : tono === 'urgente' ? 'text-amber-400' : 'text-zinc-500'
              }`}>
                {textoVencimiento(tarea.venceAt, ahora)}
              </span>
            )}
          </div>

          <div className="mt-3 flex gap-2">
            <button
              disabled={trabajando || !tarea.agendaId}
              onClick={() => setAbierta(tarea)}
              className="flex-1 rounded-lg bg-gradient-to-b from-[#b01021] to-[#8B0D1A] px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-red-950/40 hover:brightness-110 disabled:opacity-50"
            >
              {bloqueada ? 'Hacer ahora' : boton}
            </button>
            {bloqueada ? (
              <button disabled={trabajando} onClick={() => void abrirReasignar()}
                className="rounded-lg border border-white/[0.11] bg-white/[0.04] px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-white/[0.08] disabled:opacity-50">
                Reasignar
              </button>
            ) : (
              <button disabled={trabajando} onClick={() => setVerPosponer((v) => !v)}
                className="rounded-lg border border-white/[0.11] bg-white/[0.04] px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-white/[0.08] disabled:opacity-50">
                Posponer
              </button>
            )}
          </div>

          {verPosponer && !bloqueada && (
            <div className="mt-3 border-t border-dashed border-white/[0.11] pt-3">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.1em] text-zinc-600">
                {tarea.opcionesPosponer.length === 1 && tono === 'urgente'
                  ? 'A menos de 2 h del vencimiento queda una sola opción'
                  : 'Posponer'}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {tarea.opcionesPosponer.map((o) => (
                  <button key={o.etiqueta} disabled={trabajando} onClick={() => void posponer(o.etiqueta)}
                    className="rounded-lg border border-white/[0.11] bg-white/[0.03] px-2.5 py-1 font-mono text-[11px] text-zinc-400 hover:border-rose-800/60 hover:bg-rose-950/30 hover:text-zinc-100 disabled:opacity-50">
                    <Clock className="mr-1 inline h-3 w-3" />{o.etiqueta}
                  </button>
                ))}
              </div>
              {tarea.tipo === 'triaje_agenda' && tarea.pospuestaVeces >= 2 && (
                <p className="mt-2 text-[11px] text-amber-400/90">
                  Ya la pospusiste {tarea.pospuestaVeces} veces. La próxima escala y se avisa al closer.
                </p>
              )}
            </div>
          )}

          {bloqueada && (
            <div className="mt-3 flex gap-1.5 border-t border-dashed border-red-400/25 pt-3 text-[11.5px] text-red-300/90">
              <Lock className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                No se puede posponer.
                {tarea.pospuestaVeces > 0 ? ` Pospuesta ${tarea.pospuestaVeces} veces.` : ''}
                {tarea.tipo === 'triaje_agenda' ? ' El closer ya fue avisado de que puede entrar sin ficha.' : ''}
              </span>
            </div>
          )}

          {responsables && (
            <div className="mt-3 max-h-40 space-y-1 overflow-y-auto border-t border-dashed border-white/[0.11] pt-3">
              {responsables.map((r) => (
                <button key={r.id} disabled={trabajando} onClick={() => void reasignar(r.id)}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs text-zinc-300 hover:bg-white/[0.06]">
                  {r.nombre} <span className="text-[10px] text-zinc-600">{r.rol}</span>
                </button>
              ))}
            </div>
          )}

          {aviso && <p className="mt-2 text-[11px] text-red-400">{aviso}</p>}

          {permiso === 'default' && (
            <button
              onClick={async () => setPermiso(await Notification.requestPermission())}
              className="mt-3 text-[11px] text-zinc-600 underline-offset-2 hover:text-zinc-400 hover:underline"
            >
              Activar avisos del navegador para cuando el CRM esté en otra pestaña
            </button>
          )}
        </div>
      </div>
      {modal}
    </>
  )
}

/** Deja la caja completa dentro de la ventana; `rect` se midió con el desplazamiento `base` aplicado. */
function acotar(x: number, y: number, rect: DOMRect, base: { x: number; y: number }) {
  const margen = 8
  const izquierda = rect.left - base.x
  const arriba = rect.top - base.y
  const minX = margen - izquierda
  const maxX = window.innerWidth - rect.width - margen - izquierda
  const minY = margen - arriba
  const maxY = window.innerHeight - rect.height - margen - arriba
  return {
    x: Math.max(minX, Math.min(maxX, x)),
    y: Math.max(minY, Math.min(maxY, y)),
  }
}

/**
 * Notificación del sistema operativo para lo nuevo y para lo que acaba de
 * vencer. Se recuerda el último tono avisado de cada tarea para no repetir el
 * mismo aviso cada 45 segundos.
 */
function avisarAlSistema(tareas: TareaSistema[], ahora: number, vistas: Map<string, string>) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    for (const t of tareas) vistas.set(t.id, tonoVencimiento(t.venceAt, ahora))
    return
  }
  const primeraVuelta = vistas.size === 0
  for (const t of tareas) {
    const tono = tonoVencimiento(t.venceAt, ahora)
    const anterior = vistas.get(t.id)
    vistas.set(t.id, tono)
    if (primeraVuelta || !document.hidden) continue
    if (anterior === undefined || (tono === 'vencido' && anterior !== 'vencido')) {
      new Notification(tono === 'vencido' ? `Vencido: ${TITULOS[t.tipo].titulo}` : TITULOS[t.tipo].titulo, {
        body: `${t.nombreLead ?? 'Agenda'} · llamada ${fechaHora(t.horaAgenda)}`,
        tag: `${t.id}-${tono}`,
      })
    }
  }
}
