'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { CallForm } from './call-form'
import { formatDate } from '@/lib/utils'
import { Plus, Phone } from 'lucide-react'

interface CallWithRelations {
  id: string
  scheduled_at: string | null
  outcome: string | null
  sentiment: string | null
  ai_summary: string | null
  next_steps: string | null
  objections: Array<{ objection: string }> | null
  fathom_call_url: string | null
  leads: {
    full_name: string | null
    ig_username: string | null
    stage: string
    clients: { name: string; ig_handle: string } | null
  } | null
  users: { full_name: string } | null
}

const outcomeLabels: Record<string, { label: string; variant: 'success' | 'danger' | 'warning' | 'default' }> = {
  completed: { label: 'Completada', variant: 'success' },
  no_show: { label: 'No Show', variant: 'danger' },
  rescheduled: { label: 'Reagendada', variant: 'warning' },
  cancelled: { label: 'Cancelada', variant: 'default' },
}

interface Props {
  calls: CallWithRelations[]
  leads: { id: string; full_name: string | null; ig_username: string | null }[]
  callers: { id: string; full_name: string }[]
}

export function CallsList({ calls, leads, callers }: Props) {
  const [showForm, setShowForm] = useState(false)

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">Llamadas de Ventas</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {calls.length} llamada{calls.length !== 1 ? 's' : ''} registrada{calls.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4" />
          Nueva Llamada
        </Button>
      </div>

      {calls.length === 0 ? (
        <Card>
          <div className="flex h-48 items-center justify-center text-zinc-500">
            No hay llamadas registradas
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {calls.map((call) => {
            const outcome = call.outcome ? outcomeLabels[call.outcome] : null
            return (
              <Card key={call.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-zinc-400" />
                      <p className="font-medium text-zinc-100">
                        {call.leads?.full_name || call.leads?.ig_username || 'Sin nombre'}
                      </p>
                      {outcome && <Badge variant={outcome.variant}>{outcome.label}</Badge>}
                      {call.sentiment && (
                        <Badge variant={
                          call.sentiment === 'positive' ? 'success' :
                          call.sentiment === 'negative' ? 'danger' : 'default'
                        }>
                          {call.sentiment}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500">
                      {call.leads?.clients?.ig_handle} · Closer: {call.users?.full_name || 'Sin asignar'}
                    </p>
                    {call.scheduled_at && (
                      <p className="text-xs text-zinc-500">{formatDate(call.scheduled_at)}</p>
                    )}
                  </div>
                  {call.fathom_call_url && (
                    <a
                      href={call.fathom_call_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      Ver en Fathom
                    </a>
                  )}
                </div>
                {call.ai_summary && (
                  <p className="mt-3 text-sm text-zinc-300 leading-relaxed">{call.ai_summary}</p>
                )}
                {call.objections && call.objections.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-zinc-400 mb-1">Objeciones:</p>
                    <div className="flex flex-wrap gap-1">
                      {call.objections.map((o, i) => (
                        <Badge key={i} variant="warning">{o.objection}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {call.next_steps && (
                  <p className="mt-2 text-xs text-zinc-400">
                    <span className="font-medium">Próximos pasos:</span> {call.next_steps}
                  </p>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {showForm && <CallForm leads={leads} callers={callers} onClose={() => setShowForm(false)} />}
    </>
  )
}
