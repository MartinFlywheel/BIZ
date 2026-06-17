'use client'

import { useState } from 'react'
import { createInteractionAction } from '@/lib/actions/interactions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { X } from 'lucide-react'
import type { Campaign, ContentPiece } from '@/lib/types'

interface Props {
  clientId: string
  campaigns: Campaign[]
  contentPieces: ContentPiece[]
  onClose: () => void
}

export function InteractionForm({ clientId, campaigns, contentPieces, onClose }: Props) {
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    const formData = new FormData(e.currentTarget)
    formData.set('client_id', clientId)
    await createInteractionAction(formData)
    setLoading(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-zinc-50">Nueva Interacción</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input id="ig_username" name="ig_username" label="@Username del Prospecto" placeholder="@prospecto123" />
          <Input id="prospect_name" name="prospect_name" label="Nombre" placeholder="Juan Pérez" />
          <Select id="classification" name="classification" label="Clasificación" options={[
            { value: 'chat_abierto', label: 'Chat Abierto (bot trigger)' },
            { value: 'conversacion_real', label: 'Conversación Real (respondió filtro)' },
            { value: 'disqualified', label: 'Descalificado' },
          ]} />
          <Input id="keyword_used" name="keyword_used" label="Keyword Usada" placeholder="INFO" />
          <Select id="source" name="source" label="Fuente" options={[
            { value: 'manual', label: 'Manual' },
            { value: 'manychat', label: 'Manychat' },
            { value: 'gohighlevel', label: 'GoHighLevel' },
          ]} />
          {contentPieces.length > 0 && (
            <Select id="content_id" name="content_id" label="Contenido de Origen" placeholder="Seleccionar..." options={
              contentPieces.map((cp) => ({ value: cp.id, label: `${cp.content_type}: ${cp.caption?.slice(0, 40) || 'Sin caption'}` }))
            } />
          )}
          {campaigns.length > 0 && (
            <Select id="campaign_id" name="campaign_id" label="Campaña" placeholder="Sin campaña" options={
              campaigns.map((c) => ({ value: c.id, label: c.name }))
            } />
          )}
          <Input id="bot_triggered_at" name="bot_triggered_at" label="Fecha de Interacción" type="datetime-local" />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
            <Button type="submit" disabled={loading} className="flex-1">{loading ? 'Guardando...' : 'Guardar'}</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
