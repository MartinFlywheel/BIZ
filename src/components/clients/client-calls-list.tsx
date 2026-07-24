'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { createCallAction, createCallFolder, renameCallFolder, deleteCallFolder, moveCall } from '@/lib/actions/calls'
import { formatDate } from '@/lib/utils'
import { ExternalLink, Clock, Mic, Plus, X, Phone, Folder, FolderPlus, ChevronRight, CheckCircle2, XCircle, Trash2, Pencil } from 'lucide-react'
import type { SalesCall, Lead, CallFolder, CallBucket } from '@/lib/types'
import type { AgendaLeadOption } from '@/lib/actions/agenda-records'

interface Props {
    clientId: string
    calls: SalesCall[]
    leads: Lead[]
    callFolders: CallFolder[]
    agendaLeadOptions: AgendaLeadOption[]
}

function formatDuration(seconds: number | null): string {
    if (!seconds) return '—'
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${String(s).padStart(2, '0')}`
}

const OUTCOME_BADGE: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'danger' | 'info' }> = {
    completed: { label: 'Completada', variant: 'success' },
    no_show: { label: 'No Show', variant: 'danger' },
    rescheduled: { label: 'Reagendada', variant: 'warning' },
    cancelled: { label: 'Cancelada', variant: 'default' },
}

const SENTIMENT_DOT: Record<string, string> = {
    positive: 'bg-emerald-400',
    neutral: 'bg-zinc-400',
    negative: 'bg-red-400',
}

const SENTIMENT_LABEL: Record<string, string> = {
    positive: 'Positivo',
    neutral: 'Neutral',
    negative: 'Negativo',
}

const BUCKET_LABEL: Record<CallBucket, string> = {
    cerrada: 'Llamadas Cerradas',
    no_cerrada: 'Llamadas No Cerradas',
}

interface Location {
    bucket: CallBucket | null
    folderId: string | null
}

// Walk up parent_id links to build the breadcrumb chain, root-first.
function breadcrumbChain(folderId: string | null, folders: CallFolder[]): CallFolder[] {
    const chain: CallFolder[] = []
    let current = folders.find((f) => f.id === folderId) ?? null
    while (current) {
        chain.unshift(current)
        current = folders.find((f) => f.id === current!.parent_id) ?? null
    }
    return chain
}

// Flattened, indented folder list for the "move call" picker.
function flattenFolders(folders: CallFolder[], bucket: CallBucket, parentId: string | null = null, depth = 0): Array<{ folder: CallFolder; depth: number }> {
    const children = folders.filter((f) => f.bucket === bucket && f.parent_id === parentId)
    return children.flatMap((f) => [{ folder: f, depth }, ...flattenFolders(folders, bucket, f.id, depth + 1)])
}

export function ClientCallsList({ clientId, calls, leads, callFolders, agendaLeadOptions }: Props) {
    const [location, setLocation] = useState<Location>({ bucket: null, folderId: null })
    const [showForm, setShowForm] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [newFolderOpen, setNewFolderOpen] = useState(false)
    const [newFolderName, setNewFolderName] = useState('')
    const [renamingId, setRenamingId] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState('')
    const [scheduledAt, setScheduledAt] = useState('')
    const [selectedAgendaLead, setSelectedAgendaLead] = useState<AgendaLeadOption | null>(null)
    const router = useRouter()

    const leadsMap = new Map<string, Lead>()
    for (const l of leads) leadsMap.set(l.id, l)

    const cerradaCount = calls.filter((c) => c.bucket === 'cerrada').length
    const noCerradaCount = calls.filter((c) => c.bucket === 'no_cerrada').length

    const breadcrumb = location.bucket ? breadcrumbChain(location.folderId, callFolders) : []
    const subFolders = location.bucket
        ? callFolders.filter((f) => f.bucket === location.bucket && f.parent_id === location.folderId)
        : []
    const callsHere = location.bucket
        ? calls.filter((c) => c.bucket === location.bucket && (c.folder_id ?? null) === (location.folderId ?? null))
        : []

    async function handleCreateFolder() {
        const name = newFolderName.trim()
        if (!name || !location.bucket) { setNewFolderOpen(false); return }
        await createCallFolder(clientId, location.bucket, name, location.folderId)
        setNewFolderName('')
        setNewFolderOpen(false)
        router.refresh()
    }

    async function handleRenameFolder(id: string) {
        const name = renameValue.trim()
        setRenamingId(null)
        if (!name) return
        await renameCallFolder(id, name)
        router.refresh()
    }

    async function handleDeleteFolder(folder: CallFolder) {
        if (!confirm(`¿Eliminar la carpeta "${folder.name}"? Las subcarpetas también se eliminan; las llamadas adentro quedan sueltas en ${BUCKET_LABEL[folder.bucket]}.`)) return
        if (location.folderId === folder.id) setLocation({ bucket: folder.bucket, folderId: folder.parent_id })
        await deleteCallFolder(folder.id)
        router.refresh()
    }

    async function handleMoveCall(callId: string, value: string) {
        const [bucket, folderId] = value.split('|') as [CallBucket, string]
        await moveCall(callId, bucket, folderId || null)
        router.refresh()
    }

    function handleLeadChange(leadId: string) {
        const match = agendaLeadOptions.find((a) => a.lead_id === leadId) ?? null
        setSelectedAgendaLead(match)
        if (match?.fecha_agenda) setScheduledAt(`${match.fecha_agenda}T12:00`)
    }

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        setLoading(true)
        setError(null)
        try {
            const formData = new FormData(e.currentTarget)
            formData.set('client_id', clientId)
            formData.set('bucket', location.bucket ?? 'no_cerrada')
            if (location.folderId) formData.set('folder_id', location.folderId)
            await createCallAction(formData)
            router.refresh()
            setShowForm(false)
            setSelectedAgendaLead(null)
            setScheduledAt('')
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Error al registrar')
        } finally {
            setLoading(false)
        }
    }

    const sorted = [...callsHere].sort((a, b) => {
        const da = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0
        const db = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0
        return db - da
    })

    // ── Top level: the two bucket cards ──────────────────────────────────────
    if (!location.bucket) {
        return (
            <div className="space-y-4">
                <p className="text-sm text-zinc-400">
                    {calls.length} llamada{calls.length !== 1 ? 's' : ''} registrada{calls.length !== 1 ? 's' : ''}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <button
                        onClick={() => setLocation({ bucket: 'cerrada', folderId: null })}
                        className="flex items-center gap-4 rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-5 text-left hover:bg-emerald-950/30 transition-colors"
                    >
                        <div className="rounded-lg bg-emerald-500/10 p-3">
                            <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-emerald-300">Llamadas Cerradas</p>
                            <p className="text-2xl font-semibold text-zinc-50 font-mono">{cerradaCount}</p>
                        </div>
                    </button>
                    <button
                        onClick={() => setLocation({ bucket: 'no_cerrada', folderId: null })}
                        className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 text-left hover:bg-zinc-900/60 transition-colors"
                    >
                        <div className="rounded-lg bg-zinc-500/10 p-3">
                            <XCircle className="h-6 w-6 text-zinc-400" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-zinc-300">Llamadas No Cerradas</p>
                            <p className="text-2xl font-semibold text-zinc-50 font-mono">{noCerradaCount}</p>
                        </div>
                    </button>
                </div>
            </div>
        )
    }

    const bucketAccent = location.bucket === 'cerrada' ? 'text-emerald-400' : 'text-zinc-300'
    const moveOptions = (['cerrada', 'no_cerrada'] as CallBucket[]).flatMap((bucket) => [
        { value: `${bucket}|`, label: `${BUCKET_LABEL[bucket]} (raíz)` },
        ...flattenFolders(callFolders, bucket).map(({ folder, depth }) => ({
            value: `${bucket}|${folder.id}`,
            label: `${'—'.repeat(depth + 1)} ${folder.name}`,
        })),
    ])

    return (
        <div className="space-y-4">
            {/* ── Breadcrumb ── */}
            <div className="flex items-center gap-1 text-sm flex-wrap">
                <button onClick={() => setLocation({ bucket: null, folderId: null })} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                    Llamadas
                </button>
                <ChevronRight className="h-3.5 w-3.5 text-zinc-700" />
                <button
                    onClick={() => setLocation({ bucket: location.bucket, folderId: null })}
                    className={`font-medium hover:opacity-80 transition-opacity ${bucketAccent}`}
                >
                    {BUCKET_LABEL[location.bucket]}
                </button>
                {breadcrumb.map((f) => (
                    <span key={f.id} className="flex items-center gap-1">
                        <ChevronRight className="h-3.5 w-3.5 text-zinc-700" />
                        <button
                            onClick={() => setLocation({ bucket: location.bucket, folderId: f.id })}
                            className="text-zinc-400 hover:text-zinc-200 transition-colors"
                        >
                            {f.name}
                        </button>
                    </span>
                ))}
            </div>

            <div className="flex items-center justify-between">
                <p className="text-sm text-zinc-400">
                    {callsHere.length} llamada{callsHere.length !== 1 ? 's' : ''} · {subFolders.length} carpeta{subFolders.length !== 1 ? 's' : ''}
                </p>
                <div className="flex items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setNewFolderOpen(true)}>
                        <FolderPlus className="h-3.5 w-3.5" />
                        Nueva carpeta
                    </Button>
                    <Button size="sm" onClick={() => setShowForm(true)}>
                        <Plus className="h-3.5 w-3.5" />
                        Registrar Llamada
                    </Button>
                </div>
            </div>

            {/* ── Subfolders ── */}
            {(subFolders.length > 0 || newFolderOpen) && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {subFolders.map((f) => (
                        <div
                            key={f.id}
                            className="group relative rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 hover:bg-zinc-900/70 transition-colors"
                        >
                            {renamingId === f.id ? (
                                <input
                                    autoFocus
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    onBlur={() => handleRenameFolder(f.id)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') e.currentTarget.blur()
                                        if (e.key === 'Escape') setRenamingId(null)
                                    }}
                                    className="w-full bg-transparent text-xs text-zinc-100 outline-none border-b border-zinc-700"
                                />
                            ) : (
                                <button
                                    onClick={() => setLocation({ bucket: location.bucket, folderId: f.id })}
                                    className="flex items-center gap-2 w-full text-left"
                                >
                                    <Folder className="h-4 w-4 text-amber-400/80 shrink-0" />
                                    <span className="text-xs text-zinc-200 truncate">{f.name}</span>
                                </button>
                            )}
                            <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={(e) => { e.stopPropagation(); setRenamingId(f.id); setRenameValue(f.name) }}
                                    className="rounded p-1 text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.06]"
                                >
                                    <Pencil className="h-3 w-3" />
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleDeleteFolder(f) }}
                                    className="rounded p-1 text-zinc-600 hover:text-red-400 hover:bg-white/[0.06]"
                                >
                                    <Trash2 className="h-3 w-3" />
                                </button>
                            </div>
                        </div>
                    ))}
                    {newFolderOpen && (
                        <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 p-3 flex items-center gap-2">
                            <Folder className="h-4 w-4 text-zinc-600 shrink-0" />
                            <input
                                autoFocus
                                value={newFolderName}
                                onChange={(e) => setNewFolderName(e.target.value)}
                                onBlur={handleCreateFolder}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') e.currentTarget.blur()
                                    if (e.key === 'Escape') { setNewFolderName(''); setNewFolderOpen(false) }
                                }}
                                placeholder="Nombre..."
                                className="flex-1 min-w-0 bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
                            />
                        </div>
                    )}
                </div>
            )}

            {/* ── Calls in this folder ── */}
            {callsHere.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                    <Mic className="h-8 w-8 text-zinc-700 mb-3" />
                    <p className="text-sm text-zinc-500">Sin llamadas acá</p>
                    <p className="text-xs text-zinc-600 mt-1">Registrá una llamada o entrá a una subcarpeta</p>
                </div>
            ) : (
                <div className="space-y-1">
                    <div className="grid grid-cols-[1fr_140px_100px_80px_80px_160px_40px] gap-4 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
                        <span>Lead</span>
                        <span>Fecha</span>
                        <span>Estado</span>
                        <span>Duración</span>
                        <span>Sentimiento</span>
                        <span>Mover a</span>
                        <span />
                    </div>
                    <div className="divide-y divide-zinc-900">
                        {sorted.map((call) => {
                            const lead = leadsMap.get(call.lead_id)
                            const leadName = lead?.full_name || lead?.ig_username || 'Lead desconocido'
                            const outcomeCfg = call.outcome ? OUTCOME_BADGE[call.outcome] : null
                            const sentimentDot = call.sentiment ? SENTIMENT_DOT[call.sentiment] : null
                            const sentimentLabel = call.sentiment ? SENTIMENT_LABEL[call.sentiment] : null

                            return (
                                <div
                                    key={call.id}
                                    className="grid grid-cols-[1fr_140px_100px_80px_80px_160px_40px] gap-4 items-center px-4 py-3.5 rounded-lg hover:bg-zinc-900/60 transition-colors group"
                                >
                                    <div>
                                        <p className="text-sm font-medium text-zinc-100 truncate">{leadName}</p>
                                        {call.ai_summary && (
                                            <p className="text-[11px] text-zinc-600 truncate mt-0.5">{call.ai_summary}</p>
                                        )}
                                    </div>
                                    <div className="text-sm text-zinc-400">
                                        {call.scheduled_at ? formatDate(call.scheduled_at) : '—'}
                                    </div>
                                    <div>
                                        {outcomeCfg ? (
                                            <Badge variant={outcomeCfg.variant}>{outcomeCfg.label}</Badge>
                                        ) : (
                                            <span className="text-sm text-zinc-600">—</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1 text-sm text-zinc-400">
                                        {call.duration_seconds ? (
                                            <>
                                                <Clock className="h-3 w-3 text-zinc-600 flex-shrink-0" />
                                                <span className="font-mono">{formatDuration(call.duration_seconds)}</span>
                                            </>
                                        ) : (
                                            <span className="text-zinc-600">—</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        {sentimentDot && sentimentLabel ? (
                                            <>
                                                <span className={`h-2 w-2 rounded-full flex-shrink-0 ${sentimentDot}`} />
                                                <span className="text-xs text-zinc-400">{sentimentLabel}</span>
                                            </>
                                        ) : (
                                            <span className="text-zinc-600 text-sm">—</span>
                                        )}
                                    </div>
                                    <div>
                                        <select
                                            value={`${call.bucket ?? 'no_cerrada'}|${call.folder_id ?? ''}`}
                                            onChange={(e) => handleMoveCall(call.id, e.target.value)}
                                            className="w-full bg-transparent text-[11px] text-zinc-500 focus:outline-none cursor-pointer [&>option]:bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1"
                                        >
                                            {moveOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-2 justify-end">
                                        {call.next_steps?.startsWith('Google Meet:') && (
                                            <a
                                                href={call.next_steps.replace('Google Meet: ', '')}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-blue-500 hover:text-blue-400 transition-colors opacity-0 group-hover:opacity-100"
                                                title="Abrir Google Meet"
                                            >
                                                <Phone className="h-3.5 w-3.5" />
                                            </a>
                                        )}
                                        {call.fathom_call_url && (
                                            <a
                                                href={call.fathom_call_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-zinc-600 hover:text-zinc-300 transition-colors opacity-0 group-hover:opacity-100"
                                                title="Ver en Fathom"
                                            >
                                                <ExternalLink className="h-3.5 w-3.5" />
                                            </a>
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {showForm && (
                <Modal onClose={() => setShowForm(false)} size="md">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h2 className="text-lg font-semibold text-zinc-50 flex items-center gap-2">
                                <Phone className="h-4 w-4" /> Registrar Llamada
                            </h2>
                            <p className="text-xs text-zinc-500 mt-0.5">
                                Se guarda en {BUCKET_LABEL[location.bucket]}{breadcrumb.length > 0 ? ` → ${breadcrumb.map((f) => f.name).join(' → ')}` : ''}
                            </p>
                        </div>
                        <button onClick={() => setShowForm(false)} className="text-zinc-400 hover:text-zinc-200">
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <Select
                            id="lead_id"
                            name="lead_id"
                            label="Lead (agendado) *"
                            options={agendaLeadOptions.map((a) => ({
                                value: a.lead_id,
                                label: `${a.nombre_lead || 'Sin nombre'}${a.fecha_agenda ? ` — ${a.fecha_agenda}` : ''}`,
                            }))}
                            placeholder="Seleccionar lead agendado..."
                            required
                            onChange={(e) => handleLeadChange(e.target.value)}
                        />
                        {selectedAgendaLead && (
                            <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-[11px] text-zinc-500">
                                {selectedAgendaLead.avatar && <span>Avatar: <span className="text-zinc-300">{selectedAgendaLead.avatar}</span></span>}
                                {selectedAgendaLead.de_donde_vino && <span>CTA: <span className="text-zinc-300">{selectedAgendaLead.de_donde_vino}</span></span>}
                                {selectedAgendaLead.closer && <span>Closer: <span className="text-zinc-300">{selectedAgendaLead.closer}</span></span>}
                            </div>
                        )}
                        <Input
                            id="scheduled_at"
                            name="scheduled_at"
                            label="Fecha de la llamada"
                            type="datetime-local"
                            value={scheduledAt}
                            onChange={(e) => setScheduledAt(e.target.value)}
                        />
                        <Select
                            id="outcome"
                            name="outcome"
                            label="Resultado"
                            placeholder="Seleccionar..."
                            options={[
                                { value: 'completed', label: 'Completada' },
                                { value: 'no_show', label: 'No Show' },
                                { value: 'rescheduled', label: 'Reagendada' },
                                { value: 'cancelled', label: 'Cancelada' },
                            ]}
                        />
                        <Input
                            id="fathom_call_url"
                            name="fathom_call_url"
                            label="Fathom URL"
                            type="url"
                            placeholder="https://fathom.video/..."
                        />
                        <Select
                            id="sentiment"
                            name="sentiment"
                            label="Sentimiento"
                            placeholder="Sin evaluar"
                            options={[
                                { value: 'positive', label: 'Positivo' },
                                { value: 'neutral', label: 'Neutral' },
                                { value: 'negative', label: 'Negativo' },
                            ]}
                        />
                        <div className="space-y-1.5">
                            <label htmlFor="ai_summary" className="block text-sm font-medium text-zinc-400">
                                Notas / Resumen
                            </label>
                            <textarea
                                id="ai_summary"
                                name="ai_summary"
                                rows={3}
                                placeholder="Resumen de la llamada, objeciones, próximos pasos..."
                                className="flex w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 resize-none"
                            />
                        </div>

                        {error && (
                            <p className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2">
                                {error}
                            </p>
                        )}

                        <div className="flex gap-3 pt-1">
                            <Button type="button" variant="secondary" onClick={() => setShowForm(false)} className="flex-1">
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={loading} className="flex-1">
                                {loading ? 'Guardando...' : 'Registrar'}
                            </Button>
                        </div>
                    </form>
                </Modal>
            )}
        </div>
    )
}
