'use client'

import { useState } from 'react'
import { Loader2, AlertTriangle } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { createTaskAction } from '@/lib/actions/tasks'
import type { TaskEditContext } from './task-ui'

/**
 * Crear una tarea desde el CRM. La tarea nace en Notion (ahí es donde vive la
 * verdad) y vuelve al espejo en el mismo guardado, así que aparece en el
 * tablero y le llega el aviso al responsable sin tener que abrir Notion.
 */
export function NewTaskModal({
  clientId,
  edit,
  onClose,
  onCreated,
}: {
  clientId: string
  edit: TaskEditContext
  onClose: () => void
  onCreated: () => void
}) {
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState('')
  const [group, setGroup] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!title.trim()) return
    setBusy(true)
    setError(null)
    const result = await createTaskAction(clientId, {
      title: title.trim(),
      ...(edit.assigneeEditable ? { assignee: assignee || null } : {}),
      due_date: dueDate || null,
      priority: priority || null,
      group: group || null,
    }).catch((e) => ({ success: false as const, error: e instanceof Error ? e.message : 'Error inesperado' }))
    setBusy(false)
    if (result.success) onCreated()
    else setError(result.error)
  }

  const fieldCls =
    'w-full rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-white/[0.15] focus:outline-none [&>option]:bg-zinc-900 [&>option]:text-zinc-100'

  return (
    <Modal onClose={onClose} size="md">
      <h3 className="text-base font-semibold text-zinc-100">Nueva tarea</h3>
      <p className="mt-1 text-xs text-zinc-500">Se crea en Notion y aparece acá al instante.</p>

      <div className="mt-5 space-y-3">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && submit()}
          placeholder="¿Qué hay que hacer?"
          className={fieldCls}
        />

        <div className="grid grid-cols-2 gap-3">
          {edit.assigneeEditable && (
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-600">Responsable</span>
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={fieldCls}>
                <option value="">Sin asignar</option>
                {edit.options.assignee.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-600">Fecha</span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={fieldCls} />
          </label>

          {edit.options.priority.length > 0 && (
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-600">Prioridad</span>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className={fieldCls}>
                <option value="">Sin prioridad</option>
                {edit.options.priority.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {edit.options.group.length > 0 && (
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-600">Fase</span>
              <select value={group} onChange={(e) => setGroup(e.target.value)} className={fieldCls}>
                <option value="">Sin fase</option>
                {edit.options.group.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {!edit.assigneeEditable && (
          <p className="text-xs text-zinc-600">
            El responsable de esta base usa la propiedad Persona de Notion, que no se puede asignar por nombre desde acá — se asigna en Notion.
          </p>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-xs text-red-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-zinc-400 transition-colors hover:text-zinc-200">
          Cancelar
        </button>
        <button
          onClick={submit}
          disabled={busy || !title.trim()}
          className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Crear tarea
        </button>
      </div>
    </Modal>
  )
}
