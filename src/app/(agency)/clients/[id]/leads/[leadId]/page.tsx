import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { connection } from 'next/server'
import { ArrowLeft, AtSign, ExternalLink } from 'lucide-react'
import { getLeadTimeline, type LineaDeTiempoLead } from '@/lib/actions/lead-timeline'
import { LeadTimeline } from '@/components/leads/lead-timeline'

// La línea de tiempo consulta una docena de fuentes en paralelo; con un lead
// de mucha actividad en ManyChat puede pasar del límite por defecto.
export const maxDuration = 60

// Los errores de acceso de assertCanViewLead (src/lib/actions/lead-access.ts).
// Esos son un 404 honesto; cualquier otro error sube como tal, para no
// disfrazar un corte de la base de "este lead no existe".
const ERRORES_DE_ACCESO = new Set(['No autenticado', 'Lead no encontrado', 'No tienes acceso a este lead'])

const fechaFmt = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago', day: '2-digit', month: 'short', year: 'numeric',
})
const fechaHoraFmt = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
})

function prettify(key: string): string {
  const spaced = key.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function valorLegible(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value).replace(/_/g, ' ')
}

export default async function LeadHistorialPage({
  params,
}: {
  params: Promise<{ id: string; leadId: string }>
}) {
  const { id, leadId } = await params
  await connection()

  let datos: LineaDeTiempoLead
  try {
    datos = await getLeadTimeline(leadId)
  } catch (e) {
    if (e instanceof Error && ERRORES_DE_ACCESO.has(e.message)) notFound()
    throw e
  }

  // Un enlace viejo o armado a mano con otro cliente en la ruta: se lleva a la
  // URL correcta para que el botón de volver y la barra lateral cuadren.
  if (datos.lead.clientId !== id) redirect(`/clients/${datos.lead.clientId}/leads/${leadId}`)

  const { lead } = datos
  const conRespuestas = lead.agendas.find((a) => Object.keys(a.respuestas).length > 0)
  const conResumen = lead.agendas.find((a) => a.fathomResumen)
  const calificacion = Object.entries(lead.calificacion ?? {})

  return (
    <div className="space-y-6">
      <Link
        href={`/clients/${id}`}
        className="inline-flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-200"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Volver a {lead.clientName ?? 'el cliente'}
      </Link>

      {/* Cabecera */}
      <header className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-zinc-500">Historial del lead</p>
            <h1 className="mt-1 truncate text-2xl font-semibold text-zinc-50">
              {lead.fullName || (lead.igUsername ? `@${lead.igUsername}` : 'Lead sin nombre')}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-400">
              {lead.igUsername && (
                <a
                  href={`https://instagram.com/${encodeURIComponent(lead.igUsername)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-violet-300"
                >
                  <AtSign className="h-3.5 w-3.5" />{lead.igUsername} <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {lead.email && <span>{lead.email}</span>}
              {lead.phone && <span>{lead.phone}</span>}
            </div>
          </div>
          {lead.stageLabel && (
            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-xs font-medium text-zinc-200">
              {lead.stageLabel}
            </span>
          )}
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <Dato titulo="Cliente">{lead.clientName ?? '—'}</Dato>
          <Dato titulo="Setter">{lead.setterName ?? 'Sin asignar'}</Dato>
          <Dato titulo="Origen">{lead.origen ?? '—'}</Dato>
          <Dato titulo="Entró">{lead.createdAt ? fechaFmt.format(new Date(lead.createdAt)) : '—'}</Dato>
        </dl>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Línea de tiempo completa */}
        <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5">
          <h2 className="mb-4 text-sm font-semibold text-zinc-200">Línea de tiempo</h2>
          <LeadTimeline leadId={leadId} inicial={datos} />
        </section>

        {/* Panel lateral */}
        <aside className="space-y-4">
          <Panel titulo="Ficha de calificación (ManyChat)">
            {calificacion.length === 0 ? (
              <p className="text-xs text-zinc-600">El flujo no guardó datos de calificación.</p>
            ) : (
              <dl className="grid grid-cols-2 gap-3 text-xs">
                {calificacion.map(([k, v]) => (
                  <Dato key={k} titulo={prettify(k)}>{valorLegible(v)}</Dato>
                ))}
              </dl>
            )}
          </Panel>

          <Panel titulo="Respuestas del formulario de la agenda">
            {!conRespuestas ? (
              <p className="text-xs text-zinc-600">
                {lead.agendas.length === 0 ? 'Este lead no tiene agendas.' : 'La reserva no trajo respuestas.'}
              </p>
            ) : (
              <>
                <p className="mb-2 text-[11px] text-zinc-500">
                  Agenda {conRespuestas.horaAgenda ? `del ${fechaHoraFmt.format(new Date(conRespuestas.horaAgenda))}` : conRespuestas.fechaAgenda ? `del ${conRespuestas.fechaAgenda}` : ''}
                  {conRespuestas.matchMetodo === 'nombre' && (
                    <span className="text-amber-300/90"> · asociada por nombre</span>
                  )}
                </p>
                <ul className="space-y-2">
                  {Object.entries(conRespuestas.respuestas).map(([pregunta, respuesta]) => (
                    <li key={pregunta}>
                      <span className="block text-[10px] uppercase tracking-wide text-zinc-600">{pregunta}</span>
                      <span className="whitespace-pre-wrap break-words text-sm text-zinc-300">{respuesta}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>

          <Panel titulo="Resumen de la llamada (Fathom)">
            {!conResumen ? (
              <p className="text-xs text-zinc-600">Todavía no hay grabación asociada.</p>
            ) : (
              <>
                {conResumen.linkReporte && (
                  <a
                    href={conResumen.linkReporte}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mb-2 inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-violet-300"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Ver grabación
                  </a>
                )}
                {/* El resumen viene en markdown; se muestra como texto, igual
                    que en el detalle de la agenda. */}
                <div className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-xs leading-relaxed text-zinc-300">
                  {conResumen.fathomResumen!.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1')}
                </div>
              </>
            )}
          </Panel>

          {lead.lostReason && (
            <Panel titulo="Motivo de pérdida">
              <p className="text-sm text-zinc-300">{lead.lostReason}</p>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  )
}

function Panel({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{titulo}</h2>
      {children}
    </section>
  )
}

function Dato({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider text-zinc-600">{titulo}</dt>
      <dd className="mt-0.5 break-words text-zinc-300">{children}</dd>
    </div>
  )
}
