'use client'

import { useState, useMemo, useTransition, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { AgendaSpreadsheet } from './agenda-spreadsheet'
import { Plus, ExternalLink, Loader2, Search, X, ChevronDown, Trash2 } from 'lucide-react'
import { LEAD_STAGES, LEAD_AVATARS } from '@/lib/types'
import type { LeadStage, Lead, ContentPiece } from '@/lib/types'
import {
  updateLeadStageAction,
  updateLeadFieldsAction,
  deleteLeadAction,
  createLeadAction,
} from '@/lib/actions/leads'
import { getAgendaTeamStats } from '@/lib/actions/team'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'

type SubTab = 'leads' | 'agendas' | 'equipo'

interface AgencyUser { id: string; full_name: string; email: string; role: string }

interface Props {
  leads: Lead[]
  agencyUsers: AgencyUser[]
  contentPieces: ContentPiece[]
  clientId: string
  customAvatars?: string[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STAGE_DOT: Record<string, string> = {
  nuevo_contacto: 'bg-zinc-400', seguimiento: 'bg-blue-400', conversando: 'bg-violet-400',
  micro_vsl_enviado: 'bg-cyan-400', vsl_chat: 'bg-cyan-300', pitcheado: 'bg-orange-400',
  calendly_enviado: 'bg-indigo-400', seguimiento_1: 'bg-blue-300', seguimiento_2: 'bg-blue-200',
  propuesta_enviada: 'bg-amber-400', agendado: 'bg-amber-300', no_calificado: 'bg-red-400',
  cierre: 'bg-emerald-400', cliente: 'bg-emerald-400', new: 'bg-zinc-400',
  contacted: 'bg-blue-400', agenda_set: 'bg-amber-300', showed_up: 'bg-amber-300',
  no_show: 'bg-red-400', closed_won: 'bg-emerald-400', closed_lost: 'bg-zinc-600',
  vsl_enviado: 'bg-cyan-400',
}

const STAGE_TEXT: Record<string, string> = {
  nuevo_contacto: 'text-zinc-400', seguimiento: 'text-blue-400', conversando: 'text-violet-400',
  micro_vsl_enviado: 'text-cyan-400', vsl_chat: 'text-cyan-300', pitcheado: 'text-orange-400',
  calendly_enviado: 'text-indigo-400', seguimiento_1: 'text-blue-300', seguimiento_2: 'text-blue-200',
  propuesta_enviada: 'text-amber-400', agendado: 'text-amber-300', no_calificado: 'text-red-400',
  cierre: 'text-emerald-400', cliente: 'text-emerald-400', new: 'text-zinc-400',
  contacted: 'text-blue-400', closed_won: 'text-emerald-400', closed_lost: 'text-zinc-500',
  vsl_enviado: 'text-cyan-400',
}

const SOURCE_LABEL: Record<string, string> = {
  manychat_keyword: 'Instagram', manychat_direct: 'Instagram', instagram: 'Instagram',
  whatsapp: 'WhatsApp', youtube: 'YouTube', formulario: 'Formulario', manual: 'Manual',
}

const ROL_BADGE: Record<string, { label: string; color: string }> = {
  closer: { label: 'Closer', color: 'bg-emerald-950/50 text-emerald-400 border border-emerald-900/40' },
  setter: { label: 'Setter', color: 'bg-blue-950/50 text-blue-400 border border-blue-900/40' },
  admin: { label: 'Admin', color: 'bg-violet-950/50 text-violet-400 border border-violet-900/40' },
  sales_director: { label: 'Director', color: 'bg-amber-950/50 text-amber-400 border border-amber-900/40' },
  editor: { label: 'Editor', color: 'bg-zinc-800 text-zinc-400 border border-zinc-700' },
}

const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto',
  'Septiembre','Octubre','Noviembre','Diciembre']

function monthFromDate(d: string) { return MONTHS_ES[new Date(d).getMonth()] || '—' }

function dtFromDate(d: string) {
  const dt = new Date(d)
  return dt.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) +
    ' ' + dt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

// ── Inline Stage Select ───────────────────────────────────────────────────────

function StageSelect({ lead }: { lead: Lead }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [stage, setStage] = useState<LeadStage>(lead.stage)
  const dot = STAGE_DOT[stage] ?? 'bg-zinc-400'
  const text = STAGE_TEXT[stage] ?? 'text-zinc-400'

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as LeadStage
    setStage(next)
    startTransition(async () => {
      await updateLeadStageAction(lead.id, next)
      router.refresh()
    })
  }

  return (
    <div className="relative inline-flex items-center gap-1.5 min-w-[110px]">
      {isPending && <Loader2 className="h-3 w-3 text-zinc-500 animate-spin flex-shrink-0" />}
      <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${dot}`} />
      <select
        value={stage}
        onChange={handleChange}
        disabled={isPending}
        onClick={e => e.stopPropagation()}
        className={`appearance-none bg-transparent text-xs font-medium pr-4 focus:outline-none cursor-pointer max-w-[130px] truncate ${text} ${isPending ? 'opacity-50' : ''}`}
        style={{ WebkitAppearance: 'none' }}
      >
        {LEAD_STAGES.map(s => (
          <option key={s.id} value={s.id} className="bg-zinc-900 text-zinc-100">{s.label}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-0 h-3 w-3 text-zinc-600 pointer-events-none" />
    </div>
  )
}

// ── Lead Drawer ───────────────────────────────────────────────────────────────

const fieldCls = 'w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500'
const selectFieldCls = fieldCls + ' [&>option]:bg-zinc-900'

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-1">{children}</label>
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 border-b border-zinc-800 pb-1 mb-3">{children}</p>
}

interface DrawerProps {
  lead: Lead
  agencyUsers: AgencyUser[]
  contentPieces: ContentPiece[]
  avatarList: readonly string[]
  onClose: () => void
  onUpdated: (updated: Lead) => void
  onDeleted: (id: string) => void
}

function LeadDrawer({ lead, agencyUsers, contentPieces, avatarList, onClose, onUpdated, onDeleted }: DrawerProps) {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [local, setLocal] = useState<Lead>(lead)
  const pendingRef = useRef<Parameters<typeof updateLeadFieldsAction>[1]>({})
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { setMounted(true) }, [])

  const flush = useCallback(async () => {
    const toSave = { ...pendingRef.current }
    pendingRef.current = {}
    if (Object.keys(toSave).length === 0) return
    await updateLeadFieldsAction(lead.id, toSave)
  }, [lead.id])

  const debounceSave = useCallback((fields: Parameters<typeof updateLeadFieldsAction>[1]) => {
    pendingRef.current = { ...pendingRef.current, ...fields }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, 800)
  }, [flush])

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    flush()
  }, [flush])

  function set<K extends keyof typeof pendingRef.current>(
    field: K,
    value: Lead[K]
  ) {
    setLocal(prev => ({ ...prev, [field]: value }))
    debounceSave({ [field]: value } as Parameters<typeof updateLeadFieldsAction>[1])
    onUpdated({ ...local, [field]: value })
  }

  async function handleStageChange(newStage: LeadStage) {
    await flush()
    setLocal(prev => ({ ...prev, stage: newStage }))
    await updateLeadStageAction(lead.id, newStage)
    onUpdated({ ...local, stage: newStage })
    router.refresh()
  }

  async function handleDelete() {
    if (!confirm('¿Eliminar este lead? Esta acción no se puede deshacer.')) return
    await flush()
    await deleteLeadAction(lead.id)
    onDeleted(lead.id)
    router.refresh()
  }

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative z-10 h-full w-full max-w-md bg-zinc-950 border-l border-zinc-800 overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
          <div className="min-w-0 mr-3">
            <h3 className="text-base font-semibold text-zinc-100 truncate">
              {local.full_name || local.ig_username || 'Lead sin nombre'}
            </h3>
            {local.ig_username && (
              <a
                href={`https://ig.me/m/${local.ig_username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-zinc-500 hover:text-violet-400 transition-colors inline-flex items-center gap-1"
              >
                @{local.ig_username} <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <button onClick={handleDelete} className="text-xs text-zinc-600 hover:text-red-400 transition-colors flex items-center gap-1">
              <Trash2 className="h-3 w-3" /> Eliminar
            </button>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Fields */}
        <div className="p-5 space-y-5">

          {/* Lead */}
          <div>
            <SectionHead>Lead</SectionHead>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>Nombre</FieldLabel>
                <input className={fieldCls} value={local.full_name ?? ''} placeholder="Nombre del lead"
                  onChange={e => set('full_name', e.target.value || null)} />
              </div>
              <div>
                <FieldLabel>Avatar</FieldLabel>
                <select className={selectFieldCls} value={local.lead_avatar ?? ''}
                  onChange={e => set('lead_avatar', e.target.value || null)}>
                  <option value="">Sin avatar</option>
                  {avatarList.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel>Estado del Pipeline</FieldLabel>
                <select className={selectFieldCls} value={local.stage}
                  onChange={e => handleStageChange(e.target.value as LeadStage)}>
                  {LEAD_STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel>Responsable (Setter)</FieldLabel>
                <select className={selectFieldCls} value={local.assigned_to ?? ''}
                  onChange={e => set('assigned_to', e.target.value || null)}>
                  <option value="">Sin asignar</option>
                  {agencyUsers.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Contacto */}
          <div>
            <SectionHead>Contacto</SectionHead>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>Usuario de IG</FieldLabel>
                <input className={fieldCls} value={local.ig_username ?? ''} placeholder="@handle"
                  onChange={e => set('ig_username', e.target.value || null)} />
              </div>
              <div>
                <FieldLabel>Email</FieldLabel>
                <input className={fieldCls} type="email" value={local.email ?? ''} placeholder="email@example.com"
                  onChange={e => set('email', e.target.value || null)} />
              </div>
              <div className="col-span-2">
                <FieldLabel>Teléfono / WhatsApp</FieldLabel>
                <input className={fieldCls} type="tel" value={local.phone ?? ''} placeholder="+54 9 11 1234-5678"
                  onChange={e => set('phone', e.target.value || null)} />
              </div>
            </div>
          </div>

          {/* Fuente */}
          <div>
            <SectionHead>Fuente</SectionHead>
            {contentPieces.length > 0 && (
              <div className="mb-3">
                <FieldLabel>CTA (Pieza de Contenido)</FieldLabel>
                <select className={selectFieldCls} value={local.content_id ?? ''}
                  onChange={e => set('content_id', e.target.value || null)}>
                  <option value="">Sin CTA</option>
                  {contentPieces.map(cp => (
                    <option key={cp.id} value={cp.id}>
                      {cp.keyword_trigger || cp.caption?.slice(0, 50) || cp.content_type}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 text-xs text-zinc-600">
              {local.first_touch_type && (
                <div>
                  <span className="text-zinc-500 block mb-0.5 text-[10px] uppercase tracking-wider">Fuente/Source</span>
                  <span>{SOURCE_LABEL[local.first_touch_type] ?? local.first_touch_type}</span>
                </div>
              )}
              <div>
                <span className="text-zinc-500 block mb-0.5 text-[10px] uppercase tracking-wider">Fecha de ingreso</span>
                <span>{dtFromDate(lead.created_at)}</span>
              </div>
            </div>
          </div>

          {/* Notas */}
          <div>
            <SectionHead>Notas</SectionHead>
            <textarea
              className={fieldCls}
              rows={4}
              value={local.notes ?? ''}
              placeholder="Notas sobre el lead..."
              onChange={e => set('notes', e.target.value || null)}
            />
          </div>

        </div>

        <p className="px-5 pb-4 text-[11px] text-zinc-700">Los cambios se guardan automáticamente</p>
      </div>
    </div>,
    document.body
  )
}

// ── Nuevo Lead Modal ───────────────────────────────────────────────────────────

function NuevoLeadModal({
  clientId,
  agencyUsers,
  contentPieces,
  avatarList,
  onClose,
}: {
  clientId: string
  agencyUsers: AgencyUser[]
  contentPieces: ContentPiece[]
  avatarList: readonly string[]
  onClose: () => void
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const fd = new FormData(e.currentTarget)
      fd.set('client_id', clientId)
      await createLeadAction(fd)
      router.refresh()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear el lead')
    } finally {
      setLoading(false)
    }
  }

  const stageOpts = LEAD_STAGES.map(s => ({ value: s.id, label: s.label }))
  const avatarOpts = Array.from(avatarList).map(a => ({ value: a, label: a }))
  const userOpts = agencyUsers.map(u => ({ value: u.id, label: u.full_name }))
  const contentOpts = contentPieces.map(cp => ({
    value: cp.id,
    label: cp.keyword_trigger || cp.caption?.slice(0, 50) || cp.content_type,
  }))

  return (
    <Dialog open onClose={onClose} title="Nuevo Lead" description="Registrá un lead manualmente">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input id="ig_username" name="ig_username" label="Usuario IG" placeholder="@usuario" />
          <Input id="full_name" name="full_name" label="Nombre Completo" placeholder="Juan Pérez" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input id="phone" name="phone" label="Teléfono" placeholder="+54 9 11 1234-5678" type="tel" />
          <Input id="email" name="email" label="Email" placeholder="juan@email.com" type="email" />
        </div>
        <Select id="stage" name="stage" label="Estado *" options={stageOpts} defaultValue="nuevo_contacto" />
        {avatarOpts.length > 0 && (
          <Select id="lead_avatar" name="lead_avatar" label="Avatar" placeholder="— Sin avatar —" options={avatarOpts} />
        )}
        {userOpts.length > 0 && (
          <Select id="assigned_to" name="assigned_to" label="Responsable (Setter)" placeholder="— Sin asignar —" options={userOpts} />
        )}
        {contentOpts.length > 0 && (
          <Select id="content_id" name="content_id" label="CTA (Pieza de Contenido)" placeholder="— Sin CTA —" options={contentOpts} />
        )}
        {error && (
          <p className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2">{error}</p>
        )}
        <div className="flex gap-3 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button type="submit" disabled={loading} className="flex-1">{loading ? 'Creando...' : 'Crear Lead'}</Button>
        </div>
      </form>
    </Dialog>
  )
}

// ── Leads Sheet ───────────────────────────────────────────────────────────────

function LeadsSheet({ leads: initialLeads, agencyUsers, contentPieces, clientId, customAvatars }: Props) {
  const [search, setSearch] = useState('')
  const [openLead, setOpenLead] = useState<Lead | null>(null)
  const [localLeads, setLocalLeads] = useState<Lead[]>(initialLeads)
  const [showNewForm, setShowNewForm] = useState(false)

  const avatarList: readonly string[] =
    customAvatars && customAvatars.length > 0 ? customAvatars : LEAD_AVATARS

  const contentMap = useMemo(() => {
    const m = new Map<string, ContentPiece>()
    for (const cp of contentPieces) m.set(cp.id, cp)
    return m
  }, [contentPieces])

  const userMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of agencyUsers) m.set(u.id, u.full_name)
    return m
  }, [agencyUsers])

  const filtered = useMemo(() =>
    localLeads.filter(l => {
      if (!search) return true
      const s = search.toLowerCase()
      return (
        l.full_name?.toLowerCase().includes(s) ||
        l.ig_username?.toLowerCase().includes(s) ||
        l.email?.toLowerCase().includes(s) ||
        l.phone?.includes(s)
      )
    }),
    [localLeads, search]
  )

  function handleUpdated(updated: Lead) {
    setLocalLeads(prev => prev.map(l => l.id === updated.id ? updated : l))
    setOpenLead(updated)
  }

  function handleDeleted(id: string) {
    setLocalLeads(prev => prev.filter(l => l.id !== id))
    setOpenLead(null)
  }

  const HEADERS = ['#', 'Nombre', 'Usuario de IG', 'Email', 'Teléfono / WhatsApp', 'CTA', 'Mes', 'Fecha de Ingreso', 'Estado del Pipeline', 'Fuente', 'Setter', 'Notas']

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Buscar por nombre, IG, email, teléfono..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 pl-9 pr-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
          />
        </div>
        <button
          onClick={() => setShowNewForm(true)}
          className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-100 transition-colors whitespace-nowrap"
        >
          <Plus className="h-3.5 w-3.5" /> Nuevo Lead
        </button>
      </div>

      {/* Spreadsheet */}
      <div className="rounded-xl border border-white/[0.06] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] border-collapse">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                {HEADERS.map((h, i) => (
                  <th key={i} className="px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 whitespace-nowrap first:pl-3 last:pr-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={HEADERS.length} className="py-14 text-center text-zinc-600 text-xs">
                    {search
                      ? 'Sin resultados para la búsqueda'
                      : 'Sin leads · se crean automáticamente vía ManyChat o manualmente'}
                  </td>
                </tr>
              ) : (
                filtered.map((lead, idx) => {
                  const cp = lead.content_id ? contentMap.get(lead.content_id) : null
                  const setterName = lead.assigned_to ? userMap.get(lead.assigned_to) : null
                  const source = lead.first_touch_type
                    ? (SOURCE_LABEL[lead.first_touch_type] ?? lead.first_touch_type)
                    : '—'

                  return (
                    <tr
                      key={lead.id}
                      onClick={() => setOpenLead(lead)}
                      className="group border-b border-white/[0.04] hover:bg-white/[0.02] cursor-pointer transition-colors"
                    >
                      <td className="pl-3 pr-2 py-2.5 text-[11px] text-zinc-600 font-mono select-none">{idx + 1}</td>
                      <td className="px-2 py-2.5 max-w-[140px]">
                        <span className="text-xs font-medium text-zinc-100 truncate block">
                          {lead.full_name || <span className="text-zinc-600 italic font-normal">Sin nombre</span>}
                        </span>
                      </td>
                      <td className="px-2 py-2.5">
                        {lead.ig_username ? (
                          <a
                            href={`https://ig.me/m/${lead.ig_username}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-xs text-violet-400 hover:text-violet-300 inline-flex items-center gap-1 whitespace-nowrap"
                          >
                            @{lead.ig_username}
                            <ExternalLink className="h-2.5 w-2.5 flex-shrink-0" />
                          </a>
                        ) : (
                          <span className="text-zinc-700 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-xs text-zinc-400 max-w-[160px]">
                        <span className="truncate block">{lead.email || <span className="text-zinc-700">—</span>}</span>
                      </td>
                      <td className="px-2 py-2.5 text-xs text-zinc-400 whitespace-nowrap">
                        {lead.phone || <span className="text-zinc-700">—</span>}
                      </td>
                      <td className="px-2 py-2.5">
                        {cp?.keyword_trigger ? (
                          <span className="text-[11px] font-mono text-cyan-400 bg-cyan-950/30 border border-cyan-900/40 rounded px-1.5 py-0.5 whitespace-nowrap">
                            {cp.keyword_trigger}
                          </span>
                        ) : (
                          <span className="text-zinc-700 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-xs text-zinc-400 whitespace-nowrap">
                        {monthFromDate(lead.created_at)}
                      </td>
                      <td className="px-2 py-2.5 text-xs text-zinc-500 whitespace-nowrap">
                        {dtFromDate(lead.created_at)}
                      </td>
                      <td className="px-2 py-2.5" onClick={e => e.stopPropagation()}>
                        <StageSelect lead={lead} />
                      </td>
                      <td className="px-2 py-2.5 text-xs text-zinc-400 whitespace-nowrap">{source}</td>
                      <td className="px-2 py-2.5 text-xs text-zinc-400 whitespace-nowrap">
                        {setterName || <span className="text-zinc-700">—</span>}
                      </td>
                      <td className="px-2 py-2.5 pr-3 text-xs text-zinc-600 max-w-[180px]">
                        <span className="truncate block">{lead.notes || '—'}</span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-zinc-700">
        {filtered.length} lead{filtered.length !== 1 ? 's' : ''} · Click en un lead para editar · Estado editable directamente en la tabla
      </p>

      {openLead && (
        <LeadDrawer
          lead={localLeads.find(l => l.id === openLead.id) ?? openLead}
          agencyUsers={agencyUsers}
          contentPieces={contentPieces}
          avatarList={avatarList}
          onClose={() => setOpenLead(null)}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
      )}

      {showNewForm && (
        <NuevoLeadModal
          clientId={clientId}
          agencyUsers={agencyUsers}
          contentPieces={contentPieces}
          avatarList={avatarList}
          onClose={() => setShowNewForm(false)}
        />
      )}
    </div>
  )
}

// ── Equipo Tab ────────────────────────────────────────────────────────────────

function EquipoTab({ clientId, agencyUsers }: { clientId: string; agencyUsers: AgencyUser[] }) {
  const [stats, setStats] = useState<Record<string, { agendas: number; shows: number; cerradas: number }>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getAgendaTeamStats(clientId)
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [clientId])

  return (
    <div className="rounded-xl border border-white/[0.06] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr className="border-b border-white/[0.06] bg-white/[0.02]">
              {['Nombre', 'Correo personal', 'Rol', 'Total Agendas', 'Total Shows', 'Ventas Cerradas', 'Show Rate', 'Close Rate'].map((h, i) => (
                <th key={i} className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 whitespace-nowrap first:pl-4">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-zinc-600 text-xs">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Cargando estadísticas...
                </td>
              </tr>
            ) : agencyUsers.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-zinc-600 text-xs">Sin miembros de equipo</td>
              </tr>
            ) : (
              agencyUsers.map(user => {
                const s = stats[user.full_name] ?? { agendas: 0, shows: 0, cerradas: 0 }
                const showRate = s.agendas > 0 ? (s.shows / s.agendas) * 100 : 0
                const closeRate = s.shows > 0 ? (s.cerradas / s.shows) * 100 : 0
                const badge = ROL_BADGE[user.role] ?? { label: user.role, color: 'bg-zinc-800 text-zinc-400 border border-zinc-700' }

                return (
                  <tr key={user.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="pl-4 pr-3 py-3 text-sm font-medium text-zinc-100">{user.full_name}</td>
                    <td className="px-3 py-3 text-xs text-zinc-500">{user.email}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${badge.color}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-sm font-mono text-zinc-200 text-center">{s.agendas}</td>
                    <td className="px-3 py-3 text-sm font-mono text-zinc-200 text-center">{s.shows}</td>
                    <td className="px-3 py-3 text-sm font-mono text-center font-semibold text-emerald-400">{s.cerradas}</td>
                    <td className="px-3 py-3 text-sm font-mono text-center">
                      <span className={showRate >= 60 ? 'text-emerald-400' : showRate >= 40 ? 'text-amber-400' : 'text-zinc-500'}>
                        {s.agendas > 0 ? `${showRate.toFixed(2)}%` : '0.00%'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-sm font-mono text-center">
                      <span className={closeRate >= 20 ? 'text-emerald-400' : closeRate >= 10 ? 'text-amber-400' : 'text-zinc-500'}>
                        {s.shows > 0 ? `${closeRate.toFixed(2)}%` : '0.00%'}
                      </span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main Export ───────────────────────────────────────────────────────────────

export function CrmTab({ leads, agencyUsers, contentPieces, clientId, customAvatars }: Props) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('leads')

  const subTabs: { id: SubTab; label: string; count?: number }[] = [
    { id: 'leads', label: 'Leads', count: leads.length },
    { id: 'agendas', label: 'Agendas' },
    { id: 'equipo', label: 'Equipo', count: agencyUsers.length },
  ]

  return (
    <div className="space-y-0">
      {/* Sub-tab navigation */}
      <div className="flex items-center gap-0 border-b border-zinc-800 mb-5">
        {subTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors -mb-px border-b-2 ${
              activeSubTab === tab.id
                ? 'border-violet-500 text-zinc-100'
                : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={`text-[10px] font-mono rounded-full px-1.5 py-0.5 ${
                activeSubTab === tab.id
                  ? 'bg-violet-950/60 text-violet-400'
                  : 'bg-zinc-800 text-zinc-600'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeSubTab === 'leads' && (
        <LeadsSheet
          leads={leads}
          agencyUsers={agencyUsers}
          contentPieces={contentPieces}
          clientId={clientId}
          customAvatars={customAvatars}
        />
      )}
      {activeSubTab === 'agendas' && (
        <AgendaSpreadsheet clientId={clientId} />
      )}
      {activeSubTab === 'equipo' && (
        <EquipoTab clientId={clientId} agencyUsers={agencyUsers} />
      )}
    </div>
  )
}
