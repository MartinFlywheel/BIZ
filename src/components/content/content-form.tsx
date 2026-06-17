'use client'

import { useState } from 'react'
import { createContentAction } from '@/lib/actions/content'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { X } from 'lucide-react'
import type { Campaign } from '@/lib/types'

interface Props {
  clientId: string
  campaigns: Campaign[]
  onClose: () => void
}

export function ContentForm({ clientId, campaigns, onClose }: Props) {
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    const formData = new FormData(e.currentTarget)
    formData.set('client_id', clientId)
    await createContentAction(formData)
    setLoading(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 overflow-y-auto py-8">
      <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-zinc-50">Agregar Contenido</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Select id="content_type" name="content_type" label="Tipo" options={[
            { value: 'reel', label: 'Reel' },
            { value: 'story', label: 'Story' },
            { value: 'post', label: 'Post' },
            { value: 'live', label: 'Live' },
          ]} />
          {campaigns.length > 0 && (
            <Select id="campaign_id" name="campaign_id" label="Campaña" placeholder="Sin campaña" options={
              campaigns.map((c) => ({ value: c.id, label: c.name }))
            } />
          )}
          <Input id="caption" name="caption" label="Caption" placeholder="Descripción del contenido..." />
          <Input id="keyword_trigger" name="keyword_trigger" label="Keyword Trigger" placeholder="INFO" />
          <Input id="ig_permalink" name="ig_permalink" label="Link de Instagram" placeholder="https://instagram.com/reel/..." />
          <Input id="published_at" name="published_at" label="Fecha de Publicación" type="datetime-local" />

          <div className="border-t border-zinc-800 pt-4">
            <p className="text-xs font-medium text-zinc-400 mb-3">MÉTRICAS (manual)</p>
            <div className="grid grid-cols-3 gap-3">
              <Input id="views" name="views" label="Views" type="number" placeholder="0" />
              <Input id="likes" name="likes" label="Likes" type="number" placeholder="0" />
              <Input id="comments" name="comments" label="Comments" type="number" placeholder="0" />
              <Input id="shares" name="shares" label="Shares" type="number" placeholder="0" />
              <Input id="saves" name="saves" label="Saves" type="number" placeholder="0" />
              <Input id="reach" name="reach" label="Reach" type="number" placeholder="0" />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
            <Button type="submit" disabled={loading} className="flex-1">{loading ? 'Guardando...' : 'Guardar'}</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
