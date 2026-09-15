'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, ArrowRightLeft, BadgeCheck, Bot, CalendarClock, CalendarPlus, CalendarX, ClipboardCheck,
  ExternalLink, FileCheck, GraduationCap, History, ListChecks, Loader2, MessageCircle, MousePointerClick,
  Phone, Repeat, Tag, Trash2, Trophy, UserCog, UserPlus, Video,
} from 'lucide-react'
import {
  getEnlaceHistorialDeAgenda,
  getLeadTimeline,
  type EventoLead,
  type LineaDeTiempoLead,
  type TipoEventoLead,
} from '@/lib/actions/lead-timeline'
import { Dialog } from '@/components/ui/dialog'

/**
 * La línea de tiempo de un lead, agrupada por día.
 *
 * Carga sola al montarse (o recibe los datos ya cargados desde el servidor):
 * nunca va en la carga inicial de la pestaña CRM, que ya tuvo problemas de
 * tiempos y de conexiones. Quien la muestra decide cuándo montarla.
 *
 * Días y horas en hora de Chile: el equipo trabaja desde ahí, y la misma
 * llamada no puede figurar en días distintos según el navegador.
 */

const ZONA = 'America/Santiago'

type Icono = React.ComponentType<{ className?: string }>

const ESTILO: Record<TipoEventoLead, { icono: Icono; tono: string }> = {
  ingreso: { icono: UserPlus, tono: 'text-zinc-300 border-zinc-700 bg-zinc-900' },
  cta: { icono: MousePointerClick, tono: 'text-violet-300 border-violet-900/60 bg-violet-950/40' },
  respuesta: { icono: MessageCircle, tono: 'text-violet-300 border-violet-900/60 bg-violet-950/40' },
  calificado: { icono: BadgeCheck, tono: 'text-emerald-300 border-emerald-900/60 bg-emerald-950/40' },
  manychat: { icono: Bot, tono: 'text-sky-300 border-sky-900/60 bg-sky-950/40' },
  etapa: { icono: ArrowRightLeft, tono: 'text-blue-300 border-blue-900/60 bg-blue-950/40' },
  asignacion: { icono: UserCog, tono: 'text-zinc-300 border-zinc-700 bg-zinc-900' },
  etiquetas: { icono: Tag, tono: 'text-zinc-300 border-zinc-700 bg-zinc-900' },
  seguimiento: { icono: Repeat, tono: 'text-blue-300 border-blue-900/60 bg-blue-950/40' },
  eliminado: { icono: Trash2, tono: 'text-red-300 border-red-900/60 bg-red-950/40' },
  agenda: { icono: CalendarPlus, tono: 'text-amber-300 border-amber-900/60 bg-amber-950/40' },
  reagendada: { icono: CalendarClock, tono: 'text-amber-300 border-amber-900/60 bg-amber-950/40' },
  cancelada: { icono: CalendarX, tono: 'text-red-300 border-red-900/60 bg-red-950/40' },
  triaje: { icono: ClipboardCheck, tono: 'text-rose-300 border-rose-900/60 bg-rose-950/40' },
  llamada: { icono: Phone, tono: 'text-amber-200 border-amber-900/60 bg-amber-950/40' },
  grabacion: { icono: Video, tono: 'text-indigo-300 border-indigo-900/60 bg-indigo-950/40' },
  reporte: { icono: FileCheck, tono: 'text-emerald-300 border-emerald-900/60 bg-emerald-950/40' },
  tarea: { icono: ListChecks, tono: 'text-zinc-300 border-zinc-700 bg-zinc-900' },
  cierre: { icono: Trophy, tono: 'text-emerald-300 border-emerald-900/60 bg-emerald-950/40' },
  alumno: { icono: GraduationCap, tono: 'text-emerald-300 border-emerald-900/60 bg-emerald-950/40' },
}

const claveDia = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' })
const etiquetaDiaFmt = new Intl.DateTimeFormat('es-CL', { timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const horaFmt = new Intl.DateTimeFormat('es-CL', { timeZone: ZONA, hour: '2-digit', minute: '2-digit' })

function etiquetaDia(clave: string, iso: string): string {
  const hoy = claveDia.format(new Date())
  const ayer = claveDia.format(new Date(Date.now() - 86_400_000))
  if (clave === hoy) return 'Hoy'
  if (clave === ayer) return 'Ayer'
  const texto = etiquetaDiaFmt.format(new Date(iso))
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

function agruparPorDia(eventos: EventoLead[]): { clave: string; etiqueta: string; eventos: EventoLead[] }[] {
  const grupos: { clave: string; etiqueta: string; eventos: EventoLead[] }[] = []
  for (const e of eventos) {
    const clave = claveDia.format(new Date(e.at))
    const ultimo = grupos[grupos.length - 1]
    if (ultimo && ultimo.clave === clave) ultimo.eventos.push(e)
    else grupos.push({ clave, etiqueta: etiquetaDia(clave, e.at), eventos: [e] })
  }
  return grupos
}

export function LeadTimeline({
  leadId,
  inicial,
  limite,
  compacto = false,
  onCargado,
}: {
  leadId: string
  /** Datos ya cargados en el servidor (la página del lead). */
  inicial?: LineaDeTiempoLead | null
  /** Muestra solo los N eventos más recientes. */
  limite?: number
  compacto?: boolean
  onCargado?: (datos: LineaDeTiempoLead) => void
}) {
  const [datos, setDatos] = useState<LineaDeTiempoLead | null>(inicial ?? null)
  const [error, setError] = useState<string | null>(null)
  const cargando = !datos && !error

  useEffect(() => {
    if (inicial) return
    let vigente = true
    getLeadTimeline(leadId)
      .then((d) => {
        if (!vigente) return
        setDatos(d)
        onCargado?.(d)
      })
      .catch((e) => {
        if (vigente) setError(e instanceof Error && e.message ? e.message : 'No se pudo cargar el historial')
      })
    return () => { vigente = false }
    // onCargado es un aviso hacia afuera: cambiarlo no debe volver a cargar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, inicial])

  if (cargando) {
    return (
      <div className="flex items-center gap-2 py-6 text-xs text-zinc-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Armando el historial del lead...
      </div>
    )
  }

  if (error || !datos) {
    return <p className="py-4 text-xs text-zinc-500">{error ?? 'No se pudo cargar el historial'}</p>
  }

  const visibles = limite ? datos.eventos.slice(0, limite) : datos.eventos
  const grupos = agruparPorDia(visibles)
  const hayManychat = datos.eventos.some((e) => e.fuente === 'manychat')

  return (
    <div className="space-y-4">
      {datos.fuentesNoDisponibles.length > 0 && (
        <p className="rounded-md border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5 text-[11px] text-zinc-500">
          No se pudo leer: {datos.fuentesNoDisponibles.join(', ')}. El resto del historial está completo.
        </p>
      )}

      {visibles.length === 0 ? (
        <p className="text-xs text-zinc-500">Todavía no hay nada registrado para este lead.</p>
      ) : (
        grupos.map((g) => (
          <section key={g.clave}>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">{g.etiqueta}</p>
            <ol className="relative space-y-3 border-l border-zinc-800 pl-5">
              {g.eventos.map((e) => <Evento key={e.id} evento={e} compacto={compacto} />)}
            </ol>
          </section>
        ))
      )}

      {hayManychat && (
        <p className="text-[11px] text-zinc-600">
          El detalle del chat está en ManyChat: aquí se ve el último mensaje de cada paso del flujo.
        </p>
      )}
    </div>
  )
}

function Evento({ evento: e, compacto }: { evento: EventoLead; compacto: boolean }) {
  const { icono: Icon, tono } = ESTILO[e.tipo] ?? ESTILO.ingreso
  return (
    <li className="relative">
      <span className={`absolute -left-[31px] top-0 flex h-5 w-5 items-center justify-center rounded-full border ${tono}`}>
        <Icon className="h-3 w-3" />
      </span>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-[11px] text-zinc-500">{horaFmt.format(new Date(e.at))}</span>
        <span className={`${compacto ? 'text-xs' : 'text-sm'} font-medium text-zinc-200`}>{e.titulo}</span>
        {e.actor && <span className="text-[11px] text-zinc-500">· {e.actor}</span>}
      </div>
      {e.detalle && (
        <p className={`mt-0.5 whitespace-pre-wrap break-words text-zinc-400 ${compacto ? 'text-[11px]' : 'text-xs'}`}>
          {e.detalle}
        </p>
      )}
      {e.aviso && (
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-300/90">
          <AlertTriangle className="h-3 w-3 shrink-0" /> {e.aviso}
        </p>
      )}
      {e.enlace && (
        <a
          href={e.enlace.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-violet-300"
        >
          <ExternalLink className="h-3 w-3" /> {e.enlace.texto}
        </a>
      )}
    </li>
  )
}

/**
 * La sección "Línea de tiempo" del cajón del lead en la pestaña CRM.
 *
 * Cerrada por defecto: abrir un lead no dispara la docena de consultas del
 * historial, solo abrir esta sección. Muestra los 8 eventos más recientes y
 * lleva a la página completa.
 */
export function SeccionLineaDeTiempo({ clientId, leadId }: { clientId: string; leadId: string }) {
  const [abierta, setAbierta] = useState(false)
  return (
    <div>
      <p className="mb-3 border-b border-zinc-800 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
        Línea de tiempo
      </p>
      {!abierta ? (
        <button
          type="button"
          onClick={() => setAbierta(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
        >
          <History className="h-3.5 w-3.5" /> Ver lo que pasó con este lead
        </button>
      ) : (
        <div className="space-y-3">
          <LeadTimeline leadId={leadId} limite={8} compacto />
          <EnlaceHistorialLead clientId={clientId} leadId={leadId} texto="Ver historial completo" />
        </div>
      )}
    </div>
  )
}

/**
 * Botón que abre la línea de tiempo en un diálogo, para la app del setter:
 * en el teléfono conviene no salir de la lista de leads, y la tarjeta no
 * conoce el cliente para armar la ruta de la página completa.
 */
export function BotonHistorialEnDialogo({ leadId, nombre, className }: { leadId: string; nombre: string; className?: string }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        title="Ver historial del lead"
        className={className ?? 'inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300'}
      >
        <History className="h-3 w-3" /> Historial
      </button>
      <Dialog open={abierto} onClose={() => setAbierto(false)} title="Historial del lead" description={nombre}>
        {abierto && <LeadTimeline leadId={leadId} compacto />}
      </Dialog>
    </>
  )
}

/** Ruta de la página completa del lead. */
export function rutaHistorialLead(clientId: string, leadId: string): string {
  return `/clients/${clientId}/leads/${leadId}`
}

/**
 * Enlace "Ver historial del lead", para modales y tarjetas.
 *
 * `nuevaPestana` en los modales con formulario (ficha de triaje, reporte,
 * detalle de la agenda): navegar en la misma pestaña cerraría el modal y se
 * perdería lo que estaba a medio escribir.
 */
export function EnlaceHistorialLead({
  clientId,
  leadId,
  texto = 'Ver historial del lead',
  className,
  nuevaPestana = false,
}: {
  clientId: string
  leadId: string
  texto?: string
  className?: string
  nuevaPestana?: boolean
}) {
  const clase = className ?? 'inline-flex items-center gap-1 text-xs text-zinc-400 transition-colors hover:text-violet-300'
  if (nuevaPestana) {
    return (
      <a href={rutaHistorialLead(clientId, leadId)} target="_blank" rel="noopener noreferrer" className={clase}>
        <History className="h-3.5 w-3.5" /> {texto} <ExternalLink className="h-3 w-3" />
      </a>
    )
  }
  return (
    <Link href={rutaHistorialLead(clientId, leadId)} className={clase}>
      <History className="h-3.5 w-3.5" /> {texto}
    </Link>
  )
}

/**
 * El mismo enlace, para lugares que solo conocen la agenda (el reporte de la
 * llamada). Pregunta al servidor por el lead y no muestra nada si la agenda no
 * tiene lead o si quien mira no puede verlo.
 */
export function EnlaceHistorialDeAgenda({
  agendaId,
  className,
  nuevaPestana = true,
}: {
  agendaId: string
  className?: string
  nuevaPestana?: boolean
}) {
  const [destino, setDestino] = useState<{ clientId: string; leadId: string } | null>(null)

  useEffect(() => {
    let vigente = true
    getEnlaceHistorialDeAgenda(agendaId)
      .then((d) => { if (vigente) setDestino(d) })
      .catch(() => { /* sin enlace; el modal sigue funcionando */ })
    return () => { vigente = false }
  }, [agendaId])

  if (!destino) return null
  return <EnlaceHistorialLead clientId={destino.clientId} leadId={destino.leadId} className={className} nuevaPestana={nuevaPestana} />
}
