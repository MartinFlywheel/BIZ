'use client'

import { useState } from 'react'
import { createOnboardingTemplate } from '@/lib/actions/onboarding'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import type { Sop } from '@/lib/types'
import { X, Plus, Trash2 } from 'lucide-react'

interface Props {
  sops: Sop[]
  onClose: () => void
}


interface Step {
  title: string
  sop_id: string | null
}

export function OnboardingTemplateForm({ sops, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [steps, setSteps] = useState<Step[]>([{ title: '', sop_id: null }])

  function addStep() {
    setSteps([...steps, { title: '', sop_id: null }])
  }

  function removeStep(index: number) {
    setSteps(steps.filter((_, i) => i !== index))
  }

  function updateStep(index: number, field: keyof Step, value: string | null) {
    const updated = [...steps]
    updated[index] = { ...updated[index], [field]: value }
    setSteps(updated)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    const formData = new FormData(e.currentTarget)
    formData.set('steps', JSON.stringify(steps.filter((s) => s.title).map((s, i) => ({
      order: i + 1,
      title: s.title,
      sop_id: s.sop_id,
    }))))
    await createOnboardingTemplate(formData)
    setLoading(false)
    onClose()
  }

  return (
    <Modal onClose={onClose} size="md">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-zinc-50">Nuevo Template de Onboarding</h2>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200"><X className="h-5 w-5" /></button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">

        <Input id="name" name="name" label="Nombre del Template" placeholder="Onboarding Estándar" required />

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-zinc-400">Pasos</label>
          <div className="space-y-2">
            {steps.map((step, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-zinc-500 w-5">{i + 1}.</span>
                <input
                  value={step.title}
                  onChange={(e) => updateStep(i, 'title', e.target.value)}
                  placeholder="Descripción del paso..."
                  className="flex-1 h-8 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
                />
                <select
                  value={step.sop_id || ''}
                  onChange={(e) => updateStep(i, 'sop_id', e.target.value || null)}
                  className="h-8 rounded-lg border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-300"
                >
                  <option value="">Sin SOP</option>
                  {sops.map((s) => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </select>
                {steps.length > 1 && (
                  <button type="button" onClick={() => removeStep(i)} className="text-zinc-500 hover:text-red-400">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={addStep}>
            <Plus className="h-3.5 w-3.5" /> Agregar paso
          </Button>
        </div>

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button type="submit" disabled={loading} className="flex-1">{loading ? 'Creando...' : 'Crear'}</Button>
        </div>
      </form>
    </Modal>
  )
}

