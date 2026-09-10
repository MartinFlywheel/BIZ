'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { cn, formatDateCompact } from '@/lib/utils'
import {
  getLeadsResearch,
  getLeadResearchDetalle,
  updateNotasResearch,
  updateSeguimientoResearch,
  vincularLeadResearch,
} from '@/lib/actions/lead-magnet'
import { buscarLeads, type LeadBusqueda } from '@/lib/actions/leads'
import Link from 'next/link'
import {
  ETIQUETAS_PREGUNTAS,
  SEGUIMIENTOS,
  SEMAFORO_LABEL,
  enlaceWhatsapp,
  ordenIngreso,
  type LeadResearch,
  type LeadResearchDetalle,
  type Semaforo,
  type SeguimientoLead,
} from '@/lib/lead-magnet/research'
import { AlertTriangle, ExternalLink, FileText, Link2, RefreshCw, Search, X } from 'lucide-react'

/**
 * Pestaña "Research lead magnet" del cliente Carol Soto Coloma.
 *
 * Lista a todas las personas que respondieron el formulario de la landing,
 * calificadas con un semáforo por ingreso mensual, con el gancho para ventas
 * (`resumen_equipo`), el patrón detectado y el seguimiento editable. El
 * diagnóstico completo se abre en un modal sin salir del CRM.
 */

const SEMAFORO_ESTILO: Record<Semaforo, { punto: string; chip: string }> = {
  verde: { punto: 'bg-emerald-400', chip: 'bg-emerald-950 text-emerald-400 border-emerald-800' },
  amarillo: { punto: 'bg-amber-400', chip: 'bg-amber-950 text-amber-400 border-amber-800' },
  rojo: { punto: 'bg-red-400', chip: 'bg-red-950 text-red-400 border-red-800' },
  sin_dato: { punto: 'bg-zinc-500', chip: 'bg-zinc-800 text-zinc-400 border-zinc-700' },
}

const ESTADO_LABEL: Record<string, string> = {
  recibido: 'Generando',
  listo: 'Listo',
  error: 'Error',
}

function SemaforoChip({ semaforo, ingreso }: { semaforo: Semaforo; ingreso: string | null }) {
  const estilo = SEMAFORO_ESTILO[semaforo]
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium', estilo.chip)}>
      <span className={cn('h-2 w-2 rounded-full', estilo.punto)} />
      {ingreso ?? SEMAFORO_LABEL[semaforo]}
    </span>
  )
}

function Parrafos({ texto }: { texto: string | undefined }) {
  return (
    <>
      {String(texto ?? '')
        .split(/\n\s*\n/)
        .filter((p) => p.trim())
        .map((p, i) => (
          <p key={i} className="text-sm leading-relaxed text-zinc-300">
            {p.trim()}
          </p>
        ))}
    </>
  )
}

// ── Modal con el diagnóstico completo ────────────────────────────────────────

function DiagnosticoModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [detalle, setDetalle] = useState<LeadResearchDetalle | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    getLeadResearchDetalle(id)
      .then((d) => {
        if (!vigente) return
        setDetalle(d)
        if (!d) setError('No se encontró este registro.')
      })
      .catch((e) => vigente && setError(e instanceof Error ? e.message : 'No se pudo cargar el diagnóstico'))
      .finally(() => vigente && setCargando(false))
    return () => {
      vigente = false
    }
  }, [id])

  const plan = detalle?.plan ?? null
  const wa = enlaceWhatsapp(detalle?.whatsapp)

  return (
    <Modal onClose={onClose} size="xl" className="max-h-[90vh] overflow-y-auto">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Diagnóstico · Reprogramación de Identidad</p>
          {detalle && (
            <p className="mt-1 text-sm text-zinc-400">
              {formatDateCompact(detalle.creado)}
              {detalle.pais && ` · ${detalle.pais}`}
              {detalle.ocupacion && ` · ${detalle.ocupacion}`}
              {detalle.edad && ` · ${detalle.edad} años`}
            </p>
          )}
        </div>
        <button onClick={onClose} className="text-zinc-500 transition-colors hover:text-zinc-200" aria-label="Cerrar">
          <X className="h-4 w-4" />
        </button>
      </div>

      {cargando && <p className="animate-pulse text-sm text-zinc-500">Cargando diagnóstico...</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {detalle && !plan && !error && (
        <p className="text-sm text-zinc-400">
          El diagnóstico todavía no está generado (estado: {ESTADO_LABEL[detalle.estado] ?? detalle.estado}).
          {detalle.error && <span className="mt-1 block text-red-400">{detalle.error}</span>}
        </p>
      )}

      {detalle && plan && (
        <div className="space-y-6">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Gancho para el equipo</p>
            <p className="mt-1 text-sm text-zinc-100">{plan.resumen_equipo}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <SemaforoChip semaforo={detalle.semaforo} ingreso={detalle.ingreso} />
              {wa && (
                <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-400 hover:underline">
                  {detalle.whatsapp} <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            {plan.riesgo && (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-red-800 bg-red-950 px-2 py-1 text-xs font-medium text-red-400">
                <AlertTriangle className="h-3.5 w-3.5" /> Revisar antes de contactar
              </p>
            )}
          </div>

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-zinc-50">Lo que escribió</h3>
            {plan.espejo?.map((frase, i) => (
              <blockquote key={i} className="border-l-2 border-amber-700 pl-3 text-sm italic text-zinc-300">
                “{frase}”
              </blockquote>
            ))}
          </section>

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-zinc-50">Lo que está haciendo mal</h3>
            <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Patrón {plan.patron.numero} de 5</p>
              <p className="text-lg text-amber-200">{plan.patron.nombre}</p>
            </div>
            <Parrafos texto={plan.lo_que_haces_mal} />
          </section>

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-zinc-50">Lo que le está costando</h3>
            <Parrafos texto={plan.lo_que_te_cuesta} />
          </section>

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-zinc-50">Por qué lo que probó no funcionó</h3>
            <Parrafos texto={plan.por_que_no_funciono} />
          </section>

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-zinc-50">Si sigue igual</h3>
            <Parrafos texto={plan.si_sigues_igual} />
          </section>

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-zinc-50">Esto sí se resuelve</h3>
            <Parrafos texto={plan.esto_se_resuelve} />
            <Parrafos texto={plan.cierre} />
          </section>

          <details className="rounded-xl border border-zinc-800 p-4">
            <summary className="cursor-pointer text-sm font-medium text-zinc-300">Respuestas completas</summary>
            <div className="mt-3 space-y-3">
              {ETIQUETAS_PREGUNTAS.map((etiqueta, i) => {
                if (i === 16) return null
                const v = detalle.respuestas[i]
                const texto = Array.isArray(v) ? v.join(' | ') : v == null || v === '' ? '—' : String(v)
                return (
                  <div key={i}>
                    <p className="text-xs font-medium text-zinc-500">
                      {i}. {etiqueta}
                    </p>
                    <p className="text-sm text-zinc-300">{texto}</p>
                  </div>
                )
              })}
            </div>
          </details>
        </div>
      )}
    </Modal>
  )
}

// ── Vincular a mano con un lead del CRM ──────────────────────────────────────

const VINCULO_LABEL: Record<NonNullable<LeadResearch['vinculo']>, string> = {
  manual: 'vinculado a mano',
  instagram: 'por Instagram',
  telefono: 'por teléfono',
}

function VincularModal({
  lead,
  clientId,
  onClose,
  onVinculado,
}: {
  lead: LeadResearch
  clientId: string
  onClose: () => void
  onVinculado: (leadId: string | null) => Promise<void>
}) {
  const [texto, setTexto] = useState(lead.ig_username ?? '')
  const [resultados, setResultados] = useState<LeadBusqueda[]>([])
  const [buscando, setBuscando] = useState(false)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    const q = texto.trim()
    if (q.length < 2) return
    let vigente = true
    const t = setTimeout(() => {
      setBuscando(true)
      buscarLeads(clientId, q)
        .then((r) => vigente && setResultados(r))
        .catch(() => vigente && setResultados([]))
        .finally(() => vigente && setBuscando(false))
    }, 250)
    return () => {
      vigente = false
      clearTimeout(t)
    }
  }, [texto, clientId])

  async function elegir(leadId: string | null) {
    setGuardando(true)
    try {
      await onVinculado(leadId)
      onClose()
    } finally {
      setGuardando(false)
    }
  }

  const listaVisible = texto.trim().length >= 2 ? resultados : []

  return (
    <Modal onClose={onClose} size="md">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-50">Vincular con un lead del CRM</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Busca por nombre o usuario de Instagram al lead que entró por ManyChat.
          </p>
        </div>
        <button onClick={onClose} className="text-zinc-500 transition-colors hover:text-zinc-200" aria-label="Cerrar">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
        <input
          autoFocus
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Nombre o @usuario"
          className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-900 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
        />
      </div>

      <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
        {buscando && <p className="px-2 py-2 text-xs text-zinc-500">Buscando...</p>}
        {!buscando && texto.trim().length >= 2 && listaVisible.length === 0 && (
          <p className="px-2 py-2 text-xs text-zinc-500">Ningún lead coincide.</p>
        )}
        {listaVisible.map((r) => (
          <button
            key={r.id}
            type="button"
            disabled={guardando}
            onClick={() => elegir(r.id)}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            <span className="text-zinc-100">{r.full_name || 'Sin nombre'}</span>
            <span className="text-xs text-zinc-500">{r.ig_username ? `@${r.ig_username}` : ''}</span>
          </button>
        ))}
      </div>

      {lead.lead && (
        <div className="mt-4 flex items-center justify-between border-t border-zinc-800 pt-3 text-xs text-zinc-400">
          <span>
            Hoy: {lead.lead.full_name || (lead.lead.ig_username ? `@${lead.lead.ig_username}` : 'lead')}
            {lead.vinculo && ` (${VINCULO_LABEL[lead.vinculo]})`}
          </span>
          {lead.vinculo === 'manual' && (
            <button type="button" disabled={guardando} onClick={() => elegir(null)} className="text-red-400 hover:underline disabled:opacity-50">
              Quitar vínculo
            </button>
          )}
        </div>
      )}
    </Modal>
  )
}

// ── Fila de la tabla ─────────────────────────────────────────────────────────

function NotasCelda({ lead, onGuardar }: { lead: LeadResearch; onGuardar: (id: string, notas: string) => Promise<void> }) {
  const [valor, setValor] = useState(lead.notas ?? '')
  const [guardando, setGuardando] = useState(false)
  // Si las notas cambian desde afuera (recarga), el borrador se reinicia
  // ajustando el estado durante el render, sin pasar por un efecto.
  const [notasPrevias, setNotasPrevias] = useState(lead.notas)
  if (notasPrevias !== lead.notas) {
    setNotasPrevias(lead.notas)
    setValor(lead.notas ?? '')
  }

  async function guardar() {
    if (valor === (lead.notas ?? '')) return
    setGuardando(true)
    try {
      await onGuardar(lead.id, valor)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <textarea
      value={valor}
      onChange={(e) => setValor(e.target.value)}
      onBlur={guardar}
      placeholder="Notas"
      disabled={guardando}
      rows={2}
      className="w-52 resize-y rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 disabled:opacity-50"
    />
  )
}

// ── Pestaña ──────────────────────────────────────────────────────────────────

type FiltroSemaforo = 'todos' | Semaforo
type FiltroSeguimiento = 'todos' | SeguimientoLead

export function LeadMagnetTab({ clientId }: { clientId: string }) {
  const [leads, setLeads] = useState<LeadResearch[]>([])
  const [vinculando, setVinculando] = useState<LeadResearch | null>(null)
  const [configurado, setConfigurado] = useState(true)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filtroSemaforo, setFiltroSemaforo] = useState<FiltroSemaforo>('todos')
  const [filtroSeguimiento, setFiltroSeguimiento] = useState<FiltroSeguimiento>('todos')
  const [abierto, setAbierto] = useState<string | null>(null)

  const aplicar = useCallback((r: Awaited<ReturnType<typeof getLeadsResearch>>) => {
    if (!r.configurado) {
      setConfigurado(false)
      setLeads([])
    } else {
      setConfigurado(true)
      setLeads(r.leads)
    }
  }, [])

  const mensajeError = (e: unknown) => (e instanceof Error ? e.message : 'No se pudieron cargar las respuestas')

  // La carga inicial solo toca el estado dentro de la promesa; el efecto en
  // sí no llama a setState de forma síncrona.
  useEffect(() => {
    let vigente = true
    getLeadsResearch(clientId)
      .then((r) => vigente && aplicar(r))
      .catch((e) => vigente && setError(mensajeError(e)))
      .finally(() => vigente && setCargando(false))
    return () => {
      vigente = false
    }
  }, [aplicar, clientId])

  function recargar() {
    setCargando(true)
    setError(null)
    getLeadsResearch(clientId)
      .then(aplicar)
      .catch((e) => setError(mensajeError(e)))
      .finally(() => setCargando(false))
  }

  async function cambiarSeguimiento(id: string, seguimiento: SeguimientoLead) {
    const anterior = leads
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, seguimiento } : l)))
    try {
      await updateSeguimientoResearch(id, seguimiento)
    } catch (e) {
      setLeads(anterior)
      alert(e instanceof Error ? e.message : 'No se pudo guardar el seguimiento')
    }
  }

  async function vincular(id: string, leadId: string | null) {
    try {
      await vincularLeadResearch(id, leadId)
      // El cruce se recalcula en el servidor: recargar es lo más simple y seguro.
      const r = await getLeadsResearch(clientId)
      aplicar(r)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo vincular el lead')
    }
  }

  async function guardarNotas(id: string, notas: string) {
    try {
      await updateNotasResearch(id, notas)
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, notas } : l)))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudieron guardar las notas')
    }
  }

  const resumen = useMemo(() => {
    const porSemaforo: Record<Semaforo, number> = { verde: 0, amarillo: 0, rojo: 0, sin_dato: 0 }
    for (const l of leads) porSemaforo[l.semaforo]++
    return {
      total: leads.length,
      porSemaforo,
      pendientes: leads.filter((l) => l.seguimiento === 'pendiente').length,
      agendados: leads.filter((l) => l.seguimiento === 'agendado').length,
      conError: leads.filter((l) => l.estado === 'error').length,
    }
  }, [leads])

  // Verde primero, y dentro de cada color los más recientes arriba.
  const visibles = useMemo(() => {
    return leads
      .filter((l) => filtroSemaforo === 'todos' || l.semaforo === filtroSemaforo)
      .filter((l) => filtroSeguimiento === 'todos' || l.seguimiento === filtroSeguimiento)
      .sort((a, b) => ordenIngreso(b.ingreso) - ordenIngreso(a.ingreso) || b.creado.localeCompare(a.creado))
  }, [leads, filtroSemaforo, filtroSeguimiento])

  if (!configurado) {
    return (
      <div className="rounded-xl border border-amber-900/60 bg-amber-950/20 p-6 text-sm text-zinc-300">
        <p className="font-medium text-amber-300">Falta conectar la base de datos de la landing.</p>
        <p className="mt-2">
          Agrega la variable <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs">LEAD_MAGNET_DATABASE_URL</code> en
          Vercel con la misma cadena que la landing usa como <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs">DATABASE_URL</code>,
          y vuelve a desplegar.
        </p>
      </div>
    )
  }

  const chips: { label: string; valor: number; filtro?: FiltroSemaforo; punto?: string }[] = [
    { label: 'Respuestas', valor: resumen.total, filtro: 'todos' },
    { label: 'Verde', valor: resumen.porSemaforo.verde, filtro: 'verde', punto: SEMAFORO_ESTILO.verde.punto },
    { label: 'Amarillo', valor: resumen.porSemaforo.amarillo, filtro: 'amarillo', punto: SEMAFORO_ESTILO.amarillo.punto },
    { label: 'Rojo', valor: resumen.porSemaforo.rojo, filtro: 'rojo', punto: SEMAFORO_ESTILO.rojo.punto },
    { label: 'Sin contactar', valor: resumen.pendientes },
    { label: 'Agendados', valor: resumen.agendados },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <button
            key={c.label}
            type="button"
            disabled={c.filtro === undefined}
            onClick={() => c.filtro !== undefined && setFiltroSemaforo(c.filtro)}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors',
              c.filtro !== undefined && filtroSemaforo === c.filtro
                ? 'border-zinc-500 bg-zinc-800 text-zinc-100'
                : 'border-zinc-800 bg-zinc-900/60 text-zinc-400',
              c.filtro !== undefined ? 'hover:border-zinc-600 hover:text-zinc-200' : 'cursor-default'
            )}
          >
            {c.punto && <span className={cn('h-2 w-2 rounded-full', c.punto)} />}
            {c.label} <b className="text-zinc-100">{c.valor}</b>
          </button>
        ))}
        {resumen.porSemaforo.sin_dato > 0 && (
          <button
            type="button"
            onClick={() => setFiltroSemaforo('sin_dato')}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors hover:border-zinc-600 hover:text-zinc-200',
              filtroSemaforo === 'sin_dato' ? 'border-zinc-500 bg-zinc-800 text-zinc-100' : 'border-zinc-800 bg-zinc-900/60 text-zinc-400'
            )}
          >
            <span className={cn('h-2 w-2 rounded-full', SEMAFORO_ESTILO.sin_dato.punto)} />
            Sin dato <b className="text-zinc-100">{resumen.porSemaforo.sin_dato}</b>
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <select
            value={filtroSeguimiento}
            onChange={(e) => setFiltroSeguimiento(e.target.value as FiltroSeguimiento)}
            className="h-8 rounded-lg border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-200 focus-visible:outline-none"
          >
            <option value="todos">Todo seguimiento</option>
            {SEGUIMIENTOS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={recargar}
            disabled={cargando}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-xs text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', cargando && 'animate-spin')} />
            Actualizar
          </button>
        </div>
      </div>

      <p className="text-xs text-zinc-500">
        Semáforo por ingreso mensual: verde desde $1.200, amarillo entre $600 y $1.200, rojo bajo $600.
        {resumen.conError > 0 && ` · ${resumen.conError} con error de generación.`}
      </p>

      {error && (
        <div className="rounded-xl border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-300">{error}</div>
      )}

      {cargando && leads.length === 0 && <p className="animate-pulse text-sm text-zinc-500">Cargando respuestas...</p>}

      {!cargando && !error && leads.length === 0 && (
        <p className="py-10 text-center text-sm text-zinc-500">Todavía no hay respuestas al formulario.</p>
      )}

      {visibles.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-3 py-2.5 font-medium">Ingreso</th>
                <th className="px-3 py-2.5 font-medium">Persona</th>
                <th className="px-3 py-2.5 font-medium">Patrón</th>
                <th className="px-3 py-2.5 font-medium">Gancho para el equipo</th>
                <th className="px-3 py-2.5 font-medium">WhatsApp</th>
                <th className="px-3 py-2.5 font-medium">Lead en CRM</th>
                <th className="px-3 py-2.5 font-medium">Seguimiento</th>
                <th className="px-3 py-2.5 font-medium">Notas</th>
                <th className="px-3 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((l) => {
                const wa = enlaceWhatsapp(l.whatsapp)
                return (
                  <tr key={l.id} className="border-b border-zinc-800/60 align-top transition-colors last:border-0 hover:bg-zinc-900/50">
                    <td className="px-3 py-3 whitespace-nowrap">
                      <SemaforoChip semaforo={l.semaforo} ingreso={l.ingreso} />
                    </td>
                    <td className="px-3 py-3 min-w-[150px]">
                      <p className="text-zinc-200">{l.pais || '—'}</p>
                      <p className="text-xs text-zinc-500">
                        {[l.ocupacion, l.edad && `${l.edad} años`].filter(Boolean).join(' · ') || '—'}
                      </p>
                      <p className="mt-1 text-xs text-zinc-600">{formatDateCompact(l.creado)}</p>
                    </td>
                    <td className="px-3 py-3 min-w-[150px]">
                      {l.patron ? (
                        <p className="text-zinc-200">
                          <span className="text-zinc-500">{l.patron.numero}.</span> {l.patron.nombre}
                        </p>
                      ) : (
                        <span className="text-xs text-zinc-500">{ESTADO_LABEL[l.estado] ?? l.estado}</span>
                      )}
                      {l.riesgo && (
                        <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-red-400">
                          <AlertTriangle className="h-3 w-3" /> Revisar antes de contactar
                        </p>
                      )}
                      {l.estado === 'error' && l.error && (
                        <p className="mt-1 max-w-[220px] text-xs text-red-400">{l.error}</p>
                      )}
                    </td>
                    <td className="px-3 py-3 max-w-[380px] text-zinc-300 leading-relaxed">
                      {l.resumen_equipo || <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {wa ? (
                        <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-400 hover:underline">
                          {l.whatsapp} <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 min-w-[160px]">
                      {l.lead ? (
                        <>
                          <Link
                            href={`/clients/${clientId}/chat/${l.lead.id}`}
                            className="inline-flex items-center gap-1 text-zinc-100 hover:underline"
                          >
                            {l.lead.full_name || (l.lead.ig_username ? `@${l.lead.ig_username}` : 'Ver lead')}
                            <ExternalLink className="h-3 w-3 text-zinc-500" />
                          </Link>
                          <p className="text-xs text-zinc-500">
                            {l.lead.ig_username && l.lead.full_name ? `@${l.lead.ig_username} · ` : ''}
                            {l.vinculo ? VINCULO_LABEL[l.vinculo] : ''}
                          </p>
                        </>
                      ) : (
                        <p className="text-xs text-zinc-500">
                          {l.ig_username ? `@${l.ig_username} no está en el CRM` : 'Sin cruce'}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => setVinculando(l)}
                        className="mt-1 inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"
                      >
                        <Link2 className="h-3 w-3" /> {l.lead ? 'Cambiar' : 'Vincular'}
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={l.seguimiento}
                        onChange={(e) => cambiarSeguimiento(l.id, e.target.value as SeguimientoLead)}
                        className="h-8 rounded-lg border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-200 focus-visible:outline-none"
                      >
                        {SEGUIMIENTOS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <NotasCelda lead={l} onGuardar={guardarNotas} />
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setAbierto(l.id)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-xs font-medium text-zinc-100 transition-colors hover:bg-zinc-700"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        Diagnóstico
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!cargando && leads.length > 0 && visibles.length === 0 && (
        <p className="py-6 text-center text-sm text-zinc-500">Nada coincide con los filtros.</p>
      )}

      {abierto && <DiagnosticoModal id={abierto} onClose={() => setAbierto(null)} />}
      {vinculando && (
        <VincularModal
          lead={vinculando}
          clientId={clientId}
          onClose={() => setVinculando(null)}
          onVinculado={(leadId) => vincular(vinculando.id, leadId)}
        />
      )}
    </div>
  )
}
