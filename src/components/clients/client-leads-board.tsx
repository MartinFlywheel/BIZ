'use client'

import { useState, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { formatDate, formatDateCompact } from '@/lib/utils'
import { Search, Filter, User, Calendar, Phone, ExternalLink } from 'lucide-react'
import type { Lead, LeadStage } from '@/lib/types'

interface AgencyUser {
    id: string
    full_name: string
    email: string
    role: string
}

interface Props {
    leads: Lead[]
    agencyUsers: AgencyUser[]
}

// ── Stage config ──────────────────────────────────────────────────────────────

const STAGES: { id: LeadStage; label: string; color: string; dot: string }[] = [
    { id: 'new', label: 'Nuevo', color: 'bg-zinc-800 border-zinc-700', dot: 'bg-zinc-400' },
    { id: 'contacted', label: 'Contactado', color: 'bg-blue-950/40 border-blue-900/50', dot: 'bg-blue-400' },
    { id: 'agenda_set', label: 'Agenda', color: 'bg-violet-950/40 border-violet-900/50', dot: 'bg-violet-400' },
    { id: 'showed_up', label: 'Show', color: 'bg-amber-950/40 border-amber-900/50', dot: 'bg-amber-400' },
    { id: 'no_show', label: 'No Show', color: 'bg-red-950/30 border-red-900/40', dot: 'bg-red-500' },
    { id: 'closed_won', label: 'Cerrado ✓', color: 'bg-emerald-950/40 border-emerald-900/50', dot: 'bg-emerald-400' },
    { id: 'closed_lost', label: 'Perdido', color: 'bg-zinc-900/60 border-zinc-800', dot: 'bg-zinc-600' },
]

const STAGE_BADGE: Record<LeadStage, { label: string; variant: 'default' | 'success' | 'warning' | 'danger' | 'info' }> = {
    new: { label: 'Nuevo', variant: 'default' },
    contacted: { label: 'Contactado', variant: 'info' },
    agenda_set: { label: 'Agenda', variant: 'info' },
    showed_up: { label: 'Show', variant: 'warning' },
    no_show: { label: 'No Show', variant: 'danger' },
    closed_won: { label: 'Ganado', variant: 'success' },
    closed_lost: { label: 'Perdido', variant: 'default' },
}

// ── Lead Card ─────────────────────────────────────────────────────────────────

function LeadCard({ lead, agencyUsers }: { lead: Lead; agencyUsers: AgencyUser[] }) {
    const assignee = agencyUsers.find((u) => u.id === lead.assigned_to)
    const displayName = lead.full_name || lead.ig_username || 'Sin nombre'
    const lastActivity = lead.contacted_at || lead.agenda_at || lead.call_at || lead.created_at

    return (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 space-y-2 hover:border-zinc-700 transition-colors cursor-default">
            {/* Name + IG */}
            <div>
                <p className="text-sm font-medium text-zinc-100 truncate">{displayName}</p>
                {lead.ig_username && lead.full_name && (
                    <p className="text-xs text-zinc-500 truncate">@{lead.ig_username}</p>
                )}
            </div>

            {/* Meta row */}
            <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                {lastActivity && (
                    <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(lastActivity)}
                    </span>
                )}
                {lead.phone && (
                    <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {lead.phone}
                    </span>
                )}
            </div>

            {/* Assignee */}
            {assignee && (
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                    <User className="h-3 w-3" />
                    <span className="truncate">{assignee.full_name}</span>
                </div>
            )}

            {/* Close value if won */}
            {lead.stage === 'closed_won' && lead.close_value && (
                <p className="text-xs font-mono text-emerald-400">
                    ${lead.close_value.toLocaleString()}
                </p>
            )}

            {/* Lost reason */}
            {lead.stage === 'closed_lost' && lead.lost_reason && (
                <p className="text-[11px] text-zinc-600 italic truncate">{lead.lost_reason}</p>
            )}
        </div>
    )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ClientLeadsBoard({ leads, agencyUsers }: Props) {
    const [search, setSearch] = useState('')
    const [stageFilter, setStageFilter] = useState<LeadStage | 'all'>('all')
    const [view, setView] = useState<'kanban' | 'table'>('kanban')

    // Filter leads
    const filtered = useMemo(() => {
        return leads.filter((l) => {
            const matchesSearch =
                !search ||
                l.full_name?.toLowerCase().includes(search.toLowerCase()) ||
                l.ig_username?.toLowerCase().includes(search.toLowerCase()) ||
                l.phone?.includes(search) ||
                l.email?.toLowerCase().includes(search.toLowerCase())

            const matchesStage = stageFilter === 'all' || l.stage === stageFilter

            return matchesSearch && matchesStage
        })
    }, [leads, search, stageFilter])

    // Group by stage for Kanban
    const byStage = useMemo(() => {
        const map = new Map<LeadStage, Lead[]>()
        for (const s of STAGES) map.set(s.id, [])
        for (const l of filtered) {
            const arr = map.get(l.stage)
            if (arr) arr.push(l)
        }
        return map
    }, [filtered])

    const totalRevenue = leads
        .filter((l) => l.stage === 'closed_won' && l.close_value)
        .reduce((sum, l) => sum + (l.close_value || 0), 0)

    return (
        <div className="space-y-4">
            {/* ── Header Stats ── */}
            <div className="grid grid-cols-4 gap-3">
                {[
                    { label: 'Total Leads', value: leads.length, color: 'text-zinc-100' },
                    { label: 'Agendas', value: leads.filter((l) => l.stage === 'agenda_set').length, color: 'text-violet-400' },
                    { label: 'Cierres', value: leads.filter((l) => l.stage === 'closed_won').length, color: 'text-emerald-400' },
                    { label: 'Revenue', value: totalRevenue > 0 ? `$${totalRevenue.toLocaleString()}` : '—', color: 'text-emerald-400' },
                ].map((stat) => (
                    <div key={stat.label} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-center">
                        <p className={`text-xl font-semibold font-mono ${stat.color}`}>{stat.value}</p>
                        <p className="text-xs text-zinc-500 mt-0.5">{stat.label}</p>
                    </div>
                ))}
            </div>

            {/* ── Controls ── */}
            <div className="flex items-center gap-3 flex-wrap">
                {/* Search */}
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
                    <input
                        type="text"
                        placeholder="Buscar por nombre, IG, teléfono..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 pl-9 pr-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
                    />
                </div>

                {/* Stage filter */}
                <div className="flex items-center gap-1.5">
                    <Filter className="h-3.5 w-3.5 text-zinc-500" />
                    <select
                        value={stageFilter}
                        onChange={(e) => setStageFilter(e.target.value as LeadStage | 'all')}
                        className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
                    >
                        <option value="all">Todos los estados</option>
                        {STAGES.map((s) => (
                            <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                    </select>
                </div>

                {/* View toggle */}
                <div className="flex rounded-lg border border-zinc-800 overflow-hidden">
                    <button
                        onClick={() => setView('kanban')}
                        className={`px-3 py-2 text-xs font-medium transition-colors ${view === 'kanban' ? 'bg-zinc-700 text-zinc-100' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'}`}
                    >
                        Kanban
                    </button>
                    <button
                        onClick={() => setView('table')}
                        className={`px-3 py-2 text-xs font-medium transition-colors ${view === 'table' ? 'bg-zinc-700 text-zinc-100' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'}`}
                    >
                        Tabla
                    </button>
                </div>
            </div>

            {/* ── Kanban View ── */}
            {view === 'kanban' && (
                <div className="flex gap-3 overflow-x-auto pb-4">
                    {STAGES.map((stage) => {
                        const stageLeads = byStage.get(stage.id) || []
                        return (
                            <div
                                key={stage.id}
                                className={`flex-shrink-0 w-56 rounded-xl border p-3 space-y-2 ${stage.color}`}
                            >
                                {/* Column header */}
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2">
                                        <span className={`h-2 w-2 rounded-full ${stage.dot}`} />
                                        <span className="text-xs font-semibold text-zinc-300">{stage.label}</span>
                                    </div>
                                    <span className="text-xs text-zinc-500 font-mono">{stageLeads.length}</span>
                                </div>

                                {/* Cards */}
                                {stageLeads.length === 0 ? (
                                    <div className="py-6 text-center text-[11px] text-zinc-600">Sin leads</div>
                                ) : (
                                    stageLeads.map((lead) => (
                                        <LeadCard key={lead.id} lead={lead} agencyUsers={agencyUsers} />
                                    ))
                                )}
                            </div>
                        )
                    })}
                </div>
            )}

            {/* ── Table View ── */}
            {view === 'table' && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
                    {filtered.length === 0 ? (
                        <div className="py-12 text-center text-zinc-500 text-sm">Sin leads que coincidan</div>
                    ) : (
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-zinc-800/80">
                                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Usuario Instagram</th>
                                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Nombre</th>
                                    <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Chat</th>
                                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Estado</th>
                                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Última Interx.</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-900">
                                {filtered.map((lead) => {
                                    const lastActivity = lead.updated_at || lead.contacted_at || lead.agenda_at || lead.call_at || lead.created_at
                                    const stageCfg = STAGE_BADGE[lead.stage]

                                    return (
                                        <tr key={lead.id} className="hover:bg-zinc-900/60 transition-colors">
                                            <td className="px-4 py-3.5">
                                                <span className="text-sm font-semibold text-zinc-100">
                                                    {lead.ig_username || '—'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3.5 text-sm text-zinc-400">
                                                {lead.full_name || '—'}
                                            </td>
                                            <td className="px-4 py-3.5 text-center">
                                                {lead.ig_username ? (
                                                    <a
                                                        href={`https://ig.me/m/${lead.ig_username}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex text-zinc-500 hover:text-zinc-200 transition-colors"
                                                        title="Abrir DM en Instagram"
                                                    >
                                                        <ExternalLink className="h-4 w-4" />
                                                    </a>
                                                ) : (
                                                    <span className="text-zinc-700">—</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3.5">
                                                <Badge variant={stageCfg.variant}>{stageCfg.label}</Badge>
                                            </td>
                                            <td className="px-4 py-3.5 text-sm text-zinc-500">
                                                {lastActivity ? formatDateCompact(lastActivity) : '—'}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </div>
    )
}
