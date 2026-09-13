'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, UserPlus, X } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import {
  asociarLeadAAgenda,
  crearLeadDesdeAgenda,
  getCandidatosLead,
  type CandidatoLead,
} from '@/lib/actions/triage'

/**
 * Asociar el lead: el CRM adivina primero.
 *
 * El setter no busca, confirma. Solo llega aquí cuando el cruce automático del
 * sync no encontró a nadie, y ve tres o cuatro candidatos ordenados por qué tan
 * fuerte coinciden. Si ninguno es, crea el lead con los datos del formulario.
 */
export function AsociarLeadModal({
  agendaId,
  nombreLead,
  onClose,
  onListo,
}: {
  agendaId: string
  nombreLead: string | null
  onClose: () => void
  onListo?: () => void
}) {
  const [candidatos, setCandidatos] = useState<CandidatoLead[] | null>(null)
  const [elegido, setElegido] = useState<string | null>(null)
  const [instagram, setInstagram] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // La hora se toma al llegar los candidatos, no en cada render.
  const [ahora, setAhora] = useState(0)

  useEffect(() => {
    let vigente = true
    getCandidatosLead(agendaId)
      .then((c) => {
        if (!vigente) return
        setCandidatos(c)
        setAhora(Date.now())
        if (c[0] && c[0].puntaje >= 90) setElegido(c[0].id)
      })
      .catch(() => { if (vigente) setCandidatos([]) })
    return () => { vigente = false }
  }, [agendaId])

  async function ejecutar(accion: () => Promise<{ ok: boolean; error?: string }>) {
    setTrabajando(true)
    setError(null)
    try {
      const r = await accion()
      if (!r.ok) { setError(r.error ?? 'No se pudo completar'); return }
      onListo?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo completar')
    } finally {
      setTrabajando(false)
    }
  }

  const hace = (iso: string | null) => {
    if (!iso) return null
    const dias = Math.floor((ahora - new Date(iso).getTime()) / 86_400_000)
    return dias <= 0 ? 'Actividad hoy' : dias === 1 ? 'Actividad ayer' : `Actividad hace ${dias} días`
  }

  return (
    <Modal onClose={onClose} size="lg">
      <div className="mb-4 flex items-start gap-3">
        <div>
          <h3 className="text-base font-semibold text-zinc-100">Agenda sin lead</h3>
          <p className="text-xs text-zinc-500">{nombreLead || 'Reserva sin nombre'}</p>
        </div>
        <button onClick={onClose} className="ml-auto text-zinc-500 hover:text-zinc-200"><X className="h-4 w-4" /></button>
      </div>

      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Candidatos sugeridos</p>

      {candidatos === null ? (
        <div className="flex h-28 items-center justify-center text-xs text-zinc-600">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Buscando coincidencias...
        </div>
      ) : candidatos.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-800 p-4 text-xs text-zinc-500">
          Ningún lead coincide por Instagram, correo, teléfono ni nombre.
        </p>
      ) : (
        <div className="space-y-2">
          {candidatos.map((c) => (
            <button
              key={c.id}
              onClick={() => setElegido(c.id)}
              className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                elegido === c.id
                  ? 'border-emerald-700/60 bg-emerald-950/30'
                  : 'border-zinc-800 bg-zinc-950/60 hover:border-zinc-700'
              }`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-100">{c.nombre || 'Lead sin nombre'}</p>
                <p className="font-mono text-[11px] text-zinc-500">
                  {c.instagram ? `@${c.instagram}` : 'sin Instagram'}{c.etapa ? ` · ${c.etapa}` : ''}
                </p>
              </div>
              <div className="ml-auto flex flex-col items-end text-right">
                <span className={`text-[11px] ${c.puntaje >= 90 ? 'text-emerald-400' : 'text-zinc-400'}`}>{c.motivo}</span>
                <span className="text-[11px] text-zinc-600">{hace(c.actividadAt)}</span>
              </div>
              {elegido === c.id && <Check className="h-4 w-4 shrink-0 text-emerald-400" />}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          disabled={!elegido || trabajando}
          onClick={() => elegido && ejecutar(() => asociarLeadAAgenda(agendaId, elegido))}
          className="flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-[#b01021] to-[#8B0D1A] px-4 py-2 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-40"
        >
          {trabajando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Asociar
        </button>
        {error && <p className="text-[11px] text-red-400">{error}</p>}
      </div>

      <div className="mt-5 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
        <p className="mb-2 text-[11px] text-zinc-400">Ninguno coincide → crear lead nuevo con los datos del formulario.</p>
        <div className="flex gap-2">
          <input
            value={instagram}
            onChange={(e) => setInstagram(e.target.value)}
            placeholder="@usuario de Instagram (opcional)"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          />
          <button
            disabled={trabajando}
            onClick={() => ejecutar(() => crearLeadDesdeAgenda(agendaId, instagram.trim() || null))}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-700 px-3 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
          >
            <UserPlus className="h-3.5 w-3.5" /> Crear y asociar
          </button>
        </div>
      </div>
    </Modal>
  )
}
