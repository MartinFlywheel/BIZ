'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Bell, Loader2, Sparkles, X } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import {
  getDatosFicha,
  guardarFichaTriaje,
  marcarFichaLeida,
  pedirAsociacionAlSetter,
  type DatosFicha,
} from '@/lib/actions/triage'
import {
  CALIFICA_OPCIONES,
  PRIORIDAD_OPCIONES,
  TEMPERATURA_OPCIONES,
  etiquetaDe,
  type FichaTriaje,
} from '@/lib/pipeline-tipos'
import { fechaHora, textoVencimiento } from './formato'

/**
 * La ficha de triaje.
 *
 * Un botón de «completado» sin entregable produce el mismo problema que antes,
 * pero peor: queda un registro diciendo que el triaje se hizo. Por eso la tarea
 * se cierra guardando la ficha. La mitad izquierda ya viene llena; la derecha es
 * el juicio del director, que es lo único que no se automatiza.
 *
 * Si la ficha ya está guardada, se abre en modo lectura para el closer y queda
 * marcada como leída.
 */
export function FichaTriajeModal({
  agendaId,
  onClose,
  onGuardada,
  onAsociarLead,
}: {
  agendaId: string
  onClose: () => void
  onGuardada?: () => void
  onAsociarLead?: () => void
}) {
  const [datos, setDatos] = useState<DatosFicha | null>(null)
  const [cargando, setCargando] = useState(true)
  const [editando, setEditando] = useState(false)
  const [ficha, setFicha] = useState<Partial<FichaTriaje>>({})
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [setterAvisado, setSetterAvisado] = useState(false)

  useEffect(() => {
    let vigente = true
    getDatosFicha(agendaId)
      .then((d) => {
        if (!vigente) return
        setDatos(d)
        setFicha(d?.ficha ?? {})
        setEditando(!d?.ficha)
        if (d?.ficha) void marcarFichaLeida(agendaId).catch(() => {})
      })
      .catch(() => { if (vigente) setError('No se pudo cargar la agenda') })
      .finally(() => { if (vigente) setCargando(false) })
    return () => { vigente = false }
  }, [agendaId])

  async function guardar() {
    setGuardando(true)
    setError(null)
    try {
      const r = await guardarFichaTriaje(agendaId, ficha as FichaTriaje)
      if (!r.ok) {
        setError(r.error ?? 'No se pudo guardar')
        return
      }
      onGuardada?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  const respuestas = Object.entries(datos?.respuestas ?? {})

  return (
    <Modal onClose={onClose} size="xl" className="p-0! max-w-4xl!" closeOnBackdrop={!editando}>
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-4">
        <div>
          <h3 className="text-base font-semibold text-zinc-100">
            {datos?.nombreLead || 'Agenda sin nombre'}
          </h3>
          <p className="font-mono text-[11px] text-zinc-500">
            {datos?.instagram ? `@${datos.instagram} · ` : ''}
            llamada {fechaHora(datos?.horaAgenda)}
            {datos?.closer ? ` · closer ${datos.closer}` : ''}
          </p>
        </div>
        {datos?.venceAt && (
          <span className="ml-auto rounded-md border border-amber-900/50 bg-amber-950/30 px-2 py-0.5 text-[11px] text-amber-300">
            {textoVencimiento(datos.venceAt)}
          </span>
        )}
        <button onClick={onClose} className={`${datos?.venceAt ? '' : 'ml-auto'} text-zinc-500 hover:text-zinc-200`}>
          <X className="h-4 w-4" />
        </button>
      </div>

      {cargando ? (
        <div className="flex h-60 items-center justify-center text-xs text-zinc-600">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando la agenda...
        </div>
      ) : !datos ? (
        <p className="p-6 text-sm text-zinc-500">{error ?? 'No se encontró la agenda.'}</p>
      ) : (
        <>
          <div className="grid max-h-[70vh] grid-cols-1 overflow-y-auto md:grid-cols-2">
            {/* ── Ya viene lleno ─────────────────────────────────────────── */}
            <div className="space-y-4 p-5">
              <p className="flex items-center gap-1.5 border-b border-dashed border-zinc-800 pb-2 text-[10px] font-semibold uppercase tracking-wider text-blue-300/80">
                <Sparkles className="h-3 w-3" /> Ya viene lleno
              </p>

              {!datos.lead && (
                <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-3 text-xs text-amber-200/90">
                  <p className="flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="h-3.5 w-3.5" /> Esta agenda todavía no tiene lead asociado
                  </p>
                  <p className="mt-1 text-zinc-400">
                    Igual puedes hacer el triaje con lo que trae el formulario.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {onAsociarLead && (
                      <button onClick={onAsociarLead} className="rounded-md bg-amber-900/40 px-2 py-1 text-[11px] text-amber-100 hover:bg-amber-900/60">
                        Asociar ahora
                      </button>
                    )}
                    <button
                      disabled={setterAvisado}
                      onClick={async () => { await pedirAsociacionAlSetter(agendaId); setSetterAvisado(true) }}
                      className="rounded-md border border-amber-900/50 px-2 py-1 text-[11px] text-amber-200 hover:bg-amber-950/40 disabled:opacity-60"
                    >
                      {setterAvisado ? 'Setter avisado' : 'Avisar al setter'}
                    </button>
                  </div>
                </div>
              )}

              <Dato titulo="Del formulario de Calendly">
                {respuestas.length === 0 ? (
                  <span className="text-zinc-600">La reserva no trajo respuestas.</span>
                ) : (
                  <ul className="space-y-1.5">
                    {respuestas.map(([p, r]) => (
                      <li key={p}>
                        <span className="block text-[10px] uppercase tracking-wide text-zinc-600">{p}</span>
                        <span className="text-zinc-300">{r}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Dato>

              <Dato titulo="Origen">
                {[datos.deDondeVino, datos.lead?.anuncio ? `anuncio ${datos.lead.anuncio}` : null, datos.primerCta ? `1er CTA ${datos.primerCta}` : null]
                  .filter(Boolean).join(' · ') || <span className="text-zinc-600">Sin origen registrado</span>}
              </Dato>

              {datos.todosLosCtas && <Dato titulo="Todos los CTAs">{datos.todosLosCtas}</Dato>}

              <Dato titulo="Lo que anotó el setter">
                {datos.lead?.notas?.trim() || <span className="text-zinc-600">Sin notas en el lead</span>}
                {datos.setter && <span className="mt-1 block text-[11px] text-zinc-500">Setter: {datos.setter}</span>}
              </Dato>

              <Dato titulo="Historial">
                {datos.historial.agendas === 0
                  ? 'Primera agenda'
                  : `${datos.historial.agendas} agenda(s) previa(s) · ${datos.historial.noShows} no-show · ${datos.historial.cierres} cierre(s)`}
              </Dato>
            </div>

            {/* ── Lo que aporta el director ──────────────────────────────── */}
            <div className="space-y-4 border-t border-white/[0.06] p-5 md:border-l md:border-t-0">
              <p className="flex items-center gap-1.5 border-b border-dashed border-zinc-800 pb-2 text-[10px] font-semibold uppercase tracking-wider text-rose-300/80">
                <Bell className="h-3 w-3" /> Lo que aporta la dirección de ventas
              </p>

              {!editando && datos.ficha ? (
                <div className="space-y-3 text-sm">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Chip>Califica: {etiquetaDe(CALIFICA_OPCIONES, datos.ficha.califica)}</Chip>
                    <Chip>Temperatura: {etiquetaDe(TEMPERATURA_OPCIONES, datos.ficha.temperatura)}</Chip>
                    <Chip>Prioridad: {etiquetaDe(PRIORIDAD_OPCIONES, datos.ficha.prioridad)}</Chip>
                  </div>
                  <Dato titulo="Objeción previsible">{datos.ficha.objecion_prevista}</Dato>
                  <div className="rounded-lg border border-rose-900/40 bg-rose-950/20 p-3">
                    <p className="mb-1 text-[10px] uppercase tracking-wide text-rose-300/70">Ángulo recomendado para el closer</p>
                    <p className="whitespace-pre-wrap text-zinc-100">{datos.ficha.angulo}</p>
                  </div>
                  <p className="text-[11px] text-zinc-600">
                    Guardada {fechaHora(datos.fichaGuardadaAt)}
                    {datos.fichaLeidaAt ? ` · leída por el closer ${fechaHora(datos.fichaLeidaAt)}` : ' · el closer todavía no la abre'}
                  </p>
                  <button onClick={() => setEditando(true)} className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline">
                    Corregir la ficha
                  </button>
                </div>
              ) : (
                <>
                  <Segmentado etiqueta="Califica" opciones={CALIFICA_OPCIONES} valor={ficha.califica}
                    onChange={(v) => setFicha((f) => ({ ...f, califica: v }))} />
                  <Segmentado etiqueta="Temperatura" opciones={TEMPERATURA_OPCIONES} valor={ficha.temperatura}
                    onChange={(v) => setFicha((f) => ({ ...f, temperatura: v }))} />
                  <Campo etiqueta="Objeción previsible">
                    <textarea
                      rows={2}
                      value={ficha.objecion_prevista ?? ''}
                      onChange={(e) => setFicha((f) => ({ ...f, objecion_prevista: e.target.value }))}
                      placeholder="Precio, tiempo, desconfianza..."
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                    />
                  </Campo>
                  <Campo etiqueta="Ángulo recomendado para el closer">
                    <textarea
                      rows={3}
                      value={ficha.angulo ?? ''}
                      onChange={(e) => setFicha((f) => ({ ...f, angulo: e.target.value }))}
                      placeholder="Por dónde abrir, qué caso traer, qué evitar."
                      className="w-full rounded-lg border border-rose-900/50 bg-rose-950/20 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-rose-800"
                    />
                  </Campo>
                  <Segmentado etiqueta="Prioridad" opciones={PRIORIDAD_OPCIONES} valor={ficha.prioridad}
                    onChange={(v) => setFicha((f) => ({ ...f, prioridad: v }))} />
                </>
              )}
            </div>
          </div>

          {editando && (
            <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.06] px-5 py-3">
              <p className="text-[11px] text-zinc-500">
                {error ?? 'Al guardar se cierra la tarea y le llega la ficha al closer.'}
              </p>
              <button
                disabled={guardando}
                onClick={guardar}
                className="ml-auto flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-[#b01021] to-[#8B0D1A] px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-red-950/40 hover:brightness-110 disabled:opacity-50"
              >
                {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Guardar y avisar al closer
              </button>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}

function Dato({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-600">{titulo}</p>
      <div className="text-[13px] leading-relaxed text-zinc-300">{children}</div>
    </div>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-zinc-300">{children}</span>
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] uppercase tracking-wide text-zinc-500">{etiqueta}</p>
      {children}
    </div>
  )
}

function Segmentado<V extends string>({
  etiqueta,
  opciones,
  valor,
  onChange,
}: {
  etiqueta: string
  opciones: readonly { valor: V; etiqueta: string }[]
  valor: V | undefined
  onChange: (v: V) => void
}) {
  return (
    <Campo etiqueta={etiqueta}>
      <div className="flex flex-wrap gap-1.5">
        {opciones.map((o) => (
          <button
            key={o.valor}
            type="button"
            onClick={() => onChange(o.valor)}
            className={`rounded-lg border px-3 py-1 text-xs transition-colors ${
              valor === o.valor
                ? 'border-rose-700/70 bg-rose-950/50 font-semibold text-rose-100'
                : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {o.etiqueta}
          </button>
        ))}
      </div>
    </Campo>
  )
}
