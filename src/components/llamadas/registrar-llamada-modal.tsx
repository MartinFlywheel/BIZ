'use client'

import { useEffect, useState } from 'react'
import { Loader2, Phone, Search, X } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { buscarLeads, type LeadBusqueda } from '@/lib/actions/leads'
import { getAgendasDeLead, registrarLlamada, type AgendaDeLead } from '@/lib/actions/llamadas'
import { ESTADOS_REPORTE } from '@/lib/pipeline-tipos'
import { fechaCorta } from './formato'

const ESTADOS = ['Pendiente', ...ESTADOS_REPORTE]

const campo = 'flex h-9 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400'

/**
 * Registrar una llamada = completar su agenda.
 *
 * El lead se busca mientras se escribe, en vez de cargar al abrir la pestaña
 * los más de 8.000 leads del cliente para un desplegable. Si el lead ya tiene
 * agenda, se edita esa; si no, se crea una.
 */
export function RegistrarLlamadaModal({
  clientId,
  hoy,
  closers,
  onClose,
  onGuardado,
}: {
  clientId: string
  hoy: string
  closers: string[]
  onClose: () => void
  onGuardado: () => void
}) {
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState<LeadBusqueda[]>([])
  const [buscando, setBuscando] = useState(false)
  const [lead, setLead] = useState<LeadBusqueda | null>(null)
  const [sinLead, setSinLead] = useState(false)
  const [nombre, setNombre] = useState('')
  const [agendas, setAgendas] = useState<AgendaDeLead[]>([])
  const [agendaId, setAgendaId] = useState('')
  const [fecha, setFecha] = useState(hoy)
  const [hora, setHora] = useState('')
  const [closer, setCloser] = useState('')
  const [estado, setEstado] = useState('')
  const [link, setLink] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Búsqueda con una pausa corta: una consulta por pausa al escribir, no por tecla.
  useEffect(() => {
    if (lead || sinLead) return
    const q = texto.trim()
    if (q.length < 2) return
    let vigente = true
    const t = setTimeout(() => {
      setBuscando(true)
      buscarLeads(clientId, q)
        .then((r) => { if (vigente) setResultados(r) })
        .catch(() => { if (vigente) setResultados([]) })
        .finally(() => { if (vigente) setBuscando(false) })
    }, 300)
    return () => { vigente = false; clearTimeout(t) }
  }, [texto, clientId, lead, sinLead])

  async function elegirLead(l: LeadBusqueda) {
    setLead(l)
    setResultados([])
    setError(null)
    try {
      const lista = await getAgendasDeLead(clientId, l.id)
      setAgendas(lista)
      // Por defecto, la agenda más reciente que ya ocurrió: es la llamada que
      // normalmente se viene a registrar.
      const pasada = lista.find((a) => a.fecha_agenda && a.fecha_agenda <= hoy)
      if (pasada) elegirAgenda(pasada)
    } catch {
      setAgendas([])
    }
  }

  function elegirAgenda(a: AgendaDeLead | null) {
    setAgendaId(a?.id ?? '')
    if (!a) return
    if (a.fecha_agenda) setFecha(a.fecha_agenda)
    if (a.closer) setCloser(a.closer)
    if (a.estado && a.estado !== 'Pendiente') setEstado(a.estado)
  }

  const agendaElegida = agendas.find((a) => a.id === agendaId) ?? null

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setGuardando(true)
    setError(null)
    try {
      const r = await registrarLlamada({
        clientId,
        agendaId: agendaId || null,
        leadId: lead?.id ?? null,
        nombre: sinLead ? nombre : null,
        fecha,
        hora: hora || null,
        closer,
        estado,
        linkGrabacion: link,
      })
      if (!r.ok) { setError(r.error); return }
      onGuardado()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la llamada.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal onClose={onClose} size="md">
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-50">
            <Phone className="h-4 w-4" /> Registrar llamada
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Se guarda en la agenda de la llamada: si el lead ya tiene una, se completa esa.
          </p>
        </div>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200" aria-label="Cerrar">
          <X className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={guardar} className="space-y-4">
        {/* ── Lead ── */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-zinc-400">Lead</label>
          {lead ? (
            <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm">
              <span className="text-zinc-100">
                {lead.full_name || 'Sin nombre'}{lead.ig_username ? <span className="text-zinc-500"> · @{lead.ig_username}</span> : null}
              </span>
              <button
                type="button"
                onClick={() => { setLead(null); setAgendas([]); setAgendaId(''); setTexto('') }}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                Cambiar
              </button>
            </div>
          ) : sinLead ? (
            <div className="space-y-1.5">
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre de la persona" className={campo} />
              <button type="button" onClick={() => setSinLead(false)} className="text-xs text-zinc-500 hover:text-zinc-300">
                Buscar un lead en su lugar
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                <input
                  value={texto}
                  onChange={(e) => { setTexto(e.target.value); if (e.target.value.trim().length < 2) setResultados([]) }}
                  placeholder="Busca por nombre o Instagram..."
                  className={`${campo} pl-9`}
                  autoFocus
                />
                {buscando && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-zinc-500" />}
              </div>
              {resultados.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950">
                  {resultados.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => elegirLead(r)}
                      className="block w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-900"
                    >
                      {r.full_name || 'Sin nombre'}{r.ig_username ? <span className="text-zinc-500"> · @{r.ig_username}</span> : null}
                    </button>
                  ))}
                </div>
              )}
              {texto.trim().length >= 2 && !buscando && resultados.length === 0 && (
                <p className="text-xs text-zinc-500">No hay leads con ese nombre.</p>
              )}
              <button type="button" onClick={() => setSinLead(true)} className="text-xs text-zinc-500 hover:text-zinc-300">
                No está en el CRM: escribir el nombre
              </button>
            </div>
          )}
        </div>

        {/* ── Agenda del lead ── */}
        {lead && agendas.length > 0 && (
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-zinc-400">Agenda</label>
            <select value={agendaId} onChange={(e) => elegirAgenda(agendas.find((a) => a.id === e.target.value) ?? null)} className={campo}>
              {agendas.map((a) => (
                <option key={a.id} value={a.id}>
                  Completar la del {fechaCorta(a.fecha_agenda)} ({a.estado || 'Pendiente'}{a.tieneGrabacion ? ', con grabación' : ''})
                </option>
              ))}
              <option value="">Crear una agenda nueva</option>
            </select>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="llamada-fecha" className="block text-sm font-medium text-zinc-400">Fecha</label>
            <input
              id="llamada-fecha"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              disabled={!!agendaElegida?.delCalendario}
              className={campo}
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="llamada-hora" className="block text-sm font-medium text-zinc-400">Hora (Chile, opcional)</label>
            <input
              id="llamada-hora"
              type="time"
              value={hora}
              onChange={(e) => setHora(e.target.value)}
              disabled={!!agendaElegida?.delCalendario}
              className={campo}
            />
          </div>
        </div>
        {agendaElegida?.delCalendario && (
          <p className="-mt-2 text-[11px] text-zinc-500">La fecha y la hora vienen del calendario y no se cambian desde aquí.</p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="llamada-closer" className="block text-sm font-medium text-zinc-400">Closer</label>
            <input id="llamada-closer" list="llamada-closers" value={closer} onChange={(e) => setCloser(e.target.value)} className={campo} />
            <datalist id="llamada-closers">
              {closers.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="llamada-estado" className="block text-sm font-medium text-zinc-400">Resultado *</label>
            <select id="llamada-estado" value={estado} onChange={(e) => setEstado(e.target.value)} className={campo} required>
              <option value="">Seleccionar...</option>
              {ESTADOS.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="llamada-link" className="block text-sm font-medium text-zinc-400">Enlace de la grabación (opcional)</label>
          <input id="llamada-link" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://fathom.video/share/..." className={campo} />
        </div>

        {error && (
          <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">{error}</p>
        )}

        <div className="flex gap-3 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button type="submit" disabled={guardando || (!lead && !(sinLead && nombre.trim()))} className="flex-1">
            {guardando ? 'Guardando...' : 'Registrar'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
