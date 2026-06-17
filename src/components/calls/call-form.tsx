'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createCallAction } from '@/lib/actions/calls'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { X } from 'lucide-react'

interface Props {
  leads: { id: string; full_name: string | null; ig_username: string | null }[]
  callers: { id: string; full_name: string }[]
  onClose: () => void
}

export function CallForm({ leads, callers, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    const formData = new FormData(e.currentTarget)
    await createCallAction(formData)
    router.refresh()
    setLoading(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 overflow-y-auto py-8">
      <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-zinc-50">Registrar Llamada</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Select id="lead_id" name="lead_id" label="Lead" options={
            leads.map((l) => ({ value: l.id, label: l.full_name || l.ig_username || 'Sin nombre' }))
          } />
          <Select id="caller_id" name="caller_id" label="Closer" placeholder="Seleccionar..." options={
            callers.map((u) => ({ value: u.id, label: u.full_name }))
          } />
          <Input id="scheduled_at" name="scheduled_at" label="Fecha Programada" type="datetime-local" />
          <Select id="outcome" name="outcome" label="Resultado" placeholder="Pendiente" options={[
            { value: 'completed', label: 'Completada' },
            { value: 'no_show', label: 'No Show' },
            { value: 'rescheduled', label: 'Reagendada' },
            { value: 'cancelled', label: 'Cancelada' },
          ]} />
          <Select id="sentiment" name="sentiment" label="Sentimiento" placeholder="Sin evaluar" options={[
            { value: 'positive', label: 'Positivo' },
            { value: 'neutral', label: 'Neutral' },
            { value: 'negative', label: 'Negativo' },
          ]} />

          <div className="border-t border-zinc-800 pt-4 space-y-4">
            <p className="text-xs font-medium text-zinc-400">FATHOM (opcional)</p>
            <Input id="fathom_recording_id" name="fathom_recording_id" label="Fathom Recording ID" />
            <Input id="fathom_call_url" name="fathom_call_url" label="Fathom URL" placeholder="https://fathom.video/..." />
          </div>

          <textarea
            name="ai_summary"
            placeholder="Resumen de la llamada..."
            rows={3}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 resize-none"
          />
          <Input id="next_steps" name="next_steps" label="Próximos Pasos" placeholder="Enviar propuesta, agendar segunda llamada..." />

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
            <Button type="submit" disabled={loading} className="flex-1">{loading ? 'Guardando...' : 'Guardar'}</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
