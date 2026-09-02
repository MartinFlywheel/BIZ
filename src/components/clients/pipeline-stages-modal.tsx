'use client'

import { useState } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Trash2, ChevronUp, ChevronDown, Plus, Lock } from 'lucide-react'
import type { PipelineStageConfig } from '@/lib/types'
import { updateClientPipelineStagesAction } from '@/lib/actions/clients'

// Stage ids the rest of the app hardcodes behavior against — deleting one
// would silently break agenda creation, the terminal-stage filter, or the
// default a new lead lands on. Renaming (label/color) is still fine, it's
// only the id that's load-bearing.
const PROTECTED_STAGE_IDS = new Set(['nuevo_contacto', 'agendado', 'cierre', 'no_calificado'])

const COLOR_SWATCHES = [
  'text-zinc-400', 'text-blue-400', 'text-violet-400', 'text-cyan-400',
  'text-orange-400', 'text-indigo-400', 'text-amber-400', 'text-red-400',
  'text-emerald-400', 'text-pink-400', 'text-lime-400', 'text-sky-400',
]

const ACCENTED_CHARS: Record<string, string> = {
  á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n',
}

function slugify(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[áéíóúüñ]/g, (ch) => ACCENTED_CHARS[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return base || `etapa_${Date.now()}`
}

interface Props {
  clientId: string
  initialStages: PipelineStageConfig[]
  leadCountByStage?: Record<string, number>
  onClose: () => void
  onSaved: (stages: PipelineStageConfig[]) => void
}

export function PipelineStagesModal({ clientId, initialStages, leadCountByStage, onClose, onSaved }: Props) {
  const [stages, setStages] = useState<PipelineStageConfig[]>(initialStages)
  const [newLabel, setNewLabel] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addStage() {
    const label = newLabel.trim()
    if (!label) return
    let id = slugify(label)
    // Avoid id collisions (e.g. two stages both labeled "Seguimiento").
    let suffix = 2
    while (stages.some(s => s.id === id)) {
      id = `${slugify(label)}_${suffix}`
      suffix++
    }
    const usedColors = new Set(stages.map(s => s.color))
    const color = COLOR_SWATCHES.find(c => !usedColors.has(c)) ?? COLOR_SWATCHES[stages.length % COLOR_SWATCHES.length]
    setStages(prev => [...prev, { id, label, color }])
    setNewLabel('')
  }

  function updateStage(id: string, patch: Partial<PipelineStageConfig>) {
    setStages(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)))
  }

  function removeStage(id: string) {
    const count = leadCountByStage?.[id] ?? 0
    const stage = stages.find(s => s.id === id)
    if (count > 0) {
      const ok = confirm(
        `"${stage?.label ?? id}" tiene ${count} lead${count === 1 ? '' : 's'} en esta etapa ahora mismo. ` +
        `Si la eliminás, esos leads van a seguir con este estado guardado pero ya no vas a poder elegirlo de la lista.\n\n¿Eliminar igual?`
      )
      if (!ok) return
    }
    setStages(prev => prev.filter(s => s.id !== id))
  }

  function move(id: string, dir: -1 | 1) {
    setStages(prev => {
      const idx = prev.findIndex(s => s.id === id)
      const next = idx + dir
      if (idx === -1 || next < 0 || next >= prev.length) return prev
      const copy = [...prev]
      ;[copy[idx], copy[next]] = [copy[next], copy[idx]]
      return copy
    })
  }

  async function handleSave() {
    if (stages.length === 0) {
      setError('Necesitas al menos una etapa')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await updateClientPipelineStagesAction(clientId, stages)
      onSaved(stages)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron guardar las etapas')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Configurar Pipeline"
      description="Etapas del embudo de leads para este cliente"
      className="max-w-md"
    >
      <div className="space-y-2 mb-4 max-h-[50vh] overflow-y-auto">
        {stages.map((stage, i) => {
          const protectedStage = PROTECTED_STAGE_IDS.has(stage.id)
          const count = leadCountByStage?.[stage.id] ?? 0
          return (
            <div key={stage.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex flex-col -my-1">
                  <button
                    type="button"
                    onClick={() => move(stage.id, -1)}
                    disabled={i === 0}
                    className="text-zinc-600 hover:text-zinc-300 disabled:opacity-20 disabled:pointer-events-none"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(stage.id, 1)}
                    disabled={i === stages.length - 1}
                    className="text-zinc-600 hover:text-zinc-300 disabled:opacity-20 disabled:pointer-events-none"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                <span className={`h-2 w-2 rounded-full flex-shrink-0 ${stage.color.replace('text-', 'bg-')}`} />
                <input
                  value={stage.label}
                  onChange={e => updateStage(stage.id, { label: e.target.value })}
                  className="flex-1 min-w-0 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
                {protectedStage ? (
                  <span title="Etapa protegida — el sistema depende de este estado" className="text-zinc-600 p-1">
                    <Lock className="h-3.5 w-3.5" />
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => removeStage(stage.id)}
                    className="text-zinc-600 hover:text-red-400 transition-colors p-1"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1 pl-6">
                {COLOR_SWATCHES.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => updateStage(stage.id, { color: c })}
                    className={`h-4 w-4 rounded-full ${c.replace('text-', 'bg-')} ${stage.color === c ? 'ring-2 ring-offset-1 ring-offset-zinc-900 ring-white/70' : ''}`}
                  />
                ))}
                {count > 0 && (
                  <span className="ml-auto text-[10px] text-zinc-500">{count} lead{count === 1 ? '' : 's'}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex gap-2 mb-4">
        <input
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addStage() } }}
          placeholder="Nombre de la nueva etapa"
          className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
        <Button type="button" variant="secondary" onClick={addStage} disabled={!newLabel.trim()}>
          <Plus className="h-3.5 w-3.5" />
          Agregar
        </Button>
      </div>

      {error && (
        <p className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2 mb-4">{error}</p>
      )}

      <div className="flex gap-3">
        <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
        <Button type="button" onClick={handleSave} disabled={loading} className="flex-1">
          {loading ? 'Guardando...' : 'Guardar'}
        </Button>
      </div>
    </Dialog>
  )
}
