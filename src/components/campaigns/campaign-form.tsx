'use client'

import { useState } from 'react'
import { createCampaignAction } from '@/lib/actions/campaigns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { X } from 'lucide-react'

interface Props {
  clientId: string
  onClose: () => void
}

export function CampaignForm({ clientId, onClose }: Props) {
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    const formData = new FormData(e.currentTarget)
    formData.set('client_id', clientId)
    await createCampaignAction(formData)
    setLoading(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-zinc-50">Nueva Campaña</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input id="name" name="name" label="Nombre" placeholder="Lanzamiento Enero" required />
          <Input id="start_date" name="start_date" label="Fecha Inicio" type="date" required />
          <Input id="end_date" name="end_date" label="Fecha Fin" type="date" />
          <Input id="goal" name="goal" label="Objetivo" placeholder="50 agendas en 2 semanas" />
          <Select id="status" name="status" label="Estado" options={[
            { value: 'draft', label: 'Borrador' },
            { value: 'active', label: 'Activa' },
            { value: 'completed', label: 'Completada' },
          ]} />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
            <Button type="submit" disabled={loading} className="flex-1">{loading ? 'Creando...' : 'Crear'}</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
