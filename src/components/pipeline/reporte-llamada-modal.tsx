'use client'

import { useEffect, useState } from 'react'
import { Check, ExternalLink, Loader2, Sparkles, X } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { aprobarReporte, getDatosReporte, type DatosReporte } from '@/lib/actions/triage'
import { ESTADOS_REPORTE } from '@/lib/pipeline-tipos'
import { fechaHora } from './formato'
import { EnlaceHistorialDeAgenda } from '@/components/leads/lead-timeline'

type Campo = 'objecion' | 'situacion_actual' | 'dolores' | 'preguntas_no_resueltas' | 'aporte_a_mkt'

const CAMPOS_BORRADOR: { campo: Campo; etiqueta: string }[] = [
  { campo: 'objecion', etiqueta: 'Objeción / motivo de no cierre' },
  { campo: 'situacion_actual', etiqueta: 'Situación actual' },
  { campo: 'dolores', etiqueta: 'Dolores' },
  { campo: 'preguntas_no_resueltas', etiqueta: 'Preguntas no resueltas' },
]

/**
 * El reporte llega escrito a medias.
 *
 * El borrador lo armó el sistema desde el resumen de Fathom. La dirección de
 * ventas corrige lo que el resumen no captó, escribe el aporte a marketing
 * —lo único que no se puede sacar de un resumen— y aprueba.
 */
export function ReporteLlamadaModal({
  agendaId,
  onClose,
  onAprobado,
}: {
  agendaId: string
  onClose: () => void
  onAprobado?: () => void
}) {
  const [datos, setDatos] = useState<DatosReporte | null>(null)
  const [cargando, setCargando] = useState(true)
  const [valores, setValores] = useState<Record<Campo, string>>({
    objecion: '', situacion_actual: '', dolores: '', preguntas_no_resueltas: '', aporte_a_mkt: '',
  })
  const [estado, setEstado] = useState('')
  // Como texto: un input numérico vacío tiene que poder quedar vacío.
  const [montos, setMontos] = useState({ facturacion: '', upfront: '' })
  const [verResumen, setVerResumen] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    getDatosReporte(agendaId)
      .then((d) => {
        if (!vigente || !d) return
        setDatos(d)
        setValores({
          objecion: d.objecion ?? '',
          situacion_actual: d.situacion_actual ?? '',
          dolores: d.dolores ?? '',
          preguntas_no_resueltas: d.preguntas_no_resueltas ?? '',
          aporte_a_mkt: d.aporte_a_mkt ?? '',
        })
        setEstado(d.estado && d.estado !== 'Pendiente' ? d.estado : '')
        setMontos({
          facturacion: d.monto_facturacion != null ? String(d.monto_facturacion) : '',
          upfront: d.monto_upfront != null ? String(d.monto_upfront) : '',
        })
      })
      .finally(() => { if (vigente) setCargando(false) })
    return () => { vigente = false }
  }, [agendaId])

  async function aprobar() {
    setGuardando(true)
    setError(null)
    try {
      const aNumero = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v))
      const facturacion = aNumero(montos.facturacion)
      if (estado === 'Cerrado' && !(facturacion !== null && facturacion > 0)) {
        setError('Falta el monto de la venta')
        return
      }
      const r = await aprobarReporte(agendaId, {
        estado,
        ...valores,
        monto_facturacion: facturacion,
        monto_upfront: aNumero(montos.upfront),
      })
      if (!r.ok) { setError(r.error ?? 'No se pudo aprobar'); return }
      onAprobado?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo aprobar')
    } finally {
      setGuardando(false)
    }
  }

  const area = 'w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500'

  return (
    <Modal onClose={onClose} size="xl" closeOnBackdrop={false}>
      <div className="mb-4 flex items-start gap-3">
        <div>
          <h3 className="text-base font-semibold text-zinc-100">
            Reporte de llamada · {datos?.nombreLead || 'agenda'}
          </h3>
          <p className="text-[11px] text-zinc-500">
            {fechaHora(datos?.horaAgenda)}{datos?.deDondeVino ? ` · origen ${datos.deDondeVino}` : ''}
          </p>
        </div>
        {datos?.estadoReporte === 'aprobado' ? (
          <span className="ml-auto rounded-md border border-emerald-900/50 bg-emerald-950/30 px-2 py-0.5 text-[11px] text-emerald-300">Aprobado</span>
        ) : (
          <span className="ml-auto flex items-center gap-1 rounded-md border border-blue-900/50 bg-blue-950/30 px-2 py-0.5 text-[11px] text-blue-300">
            <Sparkles className="h-3 w-3" /> Borrador automático
          </span>
        )}
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200"><X className="h-4 w-4" /></button>
      </div>

      {cargando ? (
        <div className="flex h-48 items-center justify-center text-xs text-zinc-600">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando el reporte...
        </div>
      ) : !datos ? (
        <p className="text-sm text-zinc-500">No se encontró la agenda.</p>
      ) : (
        <div className="max-h-[68vh] space-y-4 overflow-y-auto pr-1">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {datos.linkGrabacion && (
              <a href={datos.linkGrabacion} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200">
                <ExternalLink className="h-3.5 w-3.5" /> Ver grabación
              </a>
            )}
            {datos.resumen && (
              <button onClick={() => setVerResumen((v) => !v)} className="text-zinc-400 hover:text-zinc-200">
                {verResumen ? 'Ocultar resumen de Fathom' : 'Ver resumen de Fathom'}
              </button>
            )}
            <EnlaceHistorialDeAgenda agendaId={agendaId} className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200" />
          </div>

          {verResumen && datos.resumen && (
            <div className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-xs leading-relaxed text-zinc-400">
              {datos.resumen.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1')}
            </div>
          )}

          {!datos.resumen && (
            <p className="rounded-lg border border-dashed border-zinc-800 p-3 text-xs text-zinc-500">
              Esta agenda todavía no tiene grabación de Fathom, así que no hay borrador. Puedes llenar el reporte a mano.
            </p>
          )}

          <div>
            <p className="mb-1.5 text-[10px] uppercase tracking-wide text-zinc-500">Estado de la llamada</p>
            <div className="flex flex-wrap gap-1.5">
              {ESTADOS_REPORTE.map((e) => (
                <button key={e} onClick={() => setEstado(e)}
                  className={`rounded-lg border px-3 py-1 text-xs ${
                    estado === e ? 'border-rose-700/70 bg-rose-950/50 font-semibold text-rose-100' : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                  }`}>
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className={`mb-1 text-[10px] uppercase tracking-wide ${estado === 'Cerrado' ? 'text-emerald-300/90' : 'text-zinc-500'}`}>
                Facturación (total de la venta){estado === 'Cerrado' ? ' · obligatoria' : ''}
              </p>
              <input type="number" min={0} inputMode="decimal" className={area} value={montos.facturacion}
                placeholder={estado === 'Cerrado' ? 'Monto de la venta' : '—'}
                onChange={(e) => setMontos((m) => ({ ...m, facturacion: e.target.value }))} />
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">Upfront (lo que pagó al cerrar)</p>
              <input type="number" min={0} inputMode="decimal" className={area} value={montos.upfront}
                placeholder="—"
                onChange={(e) => setMontos((m) => ({ ...m, upfront: e.target.value }))} />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {CAMPOS_BORRADOR.map(({ campo, etiqueta }) => (
              <div key={campo}>
                <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">{etiqueta}</p>
                <textarea rows={3} className={area} value={valores[campo]}
                  onChange={(e) => setValores((v) => ({ ...v, [campo]: e.target.value }))} />
              </div>
            ))}
          </div>

          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-rose-300/80">Aporte a marketing — lo que llega al panel</p>
            <textarea rows={3} value={valores.aporte_a_mkt}
              onChange={(e) => setValores((v) => ({ ...v, aporte_a_mkt: e.target.value }))}
              placeholder="Qué dijo de la campaña o del contenido que marketing debería saber."
              className="w-full rounded-lg border border-rose-900/50 bg-rose-950/20 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-rose-800" />
          </div>
        </div>
      )}

      {datos && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-3">
          <p className="text-[11px] text-zinc-500">{error ?? 'Solo los reportes aprobados cuentan para el panel de marketing.'}</p>
          <button disabled={guardando} onClick={aprobar}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-[#b01021] to-[#8B0D1A] px-4 py-2 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50">
            {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Aprobar reporte
          </button>
        </div>
      )}
    </Modal>
  )
}
