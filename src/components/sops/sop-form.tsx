'use client'

import { useState } from 'react'
import { createSopAction, updateSopAction } from '@/lib/actions/sops'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SOP_TAGS } from '@/lib/types'
import type { Sop } from '@/lib/types'
import { X } from 'lucide-react'


interface Props {
  sop?: Sop
  onClose: () => void
}


export function SopForm({ sop, onClose }: Props) {
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    const formData = new FormData(e.currentTarget)
    if (sop) {
      await updateSopAction(sop.id, formData)
    } else {
      await createSopAction(formData)
    }
    setLoading(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 overflow-y-auto py-8">
      <div className="w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-zinc-50">
            {sop ? 'Editar SOP' : 'Nuevo SOP'}
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            id="title"
            name="title"
            label="Título"
            placeholder="Script de Llamada de Cierre"
            defaultValue={sop?.title}
            required
          />
          <div className="space-y-1.5">
            <label htmlFor="category" className="block text-sm font-medium text-zinc-400">
              Categoría
            </label>
            <select
              id="category"
              name="category"
              defaultValue={sop?.category || ''}
              className="flex h-9 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 [&>option]:bg-zinc-900"
            >
              <option value="">Sin categoría</option>
              {SOP_TAGS.map((tag) => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-zinc-400">Contenido (Markdown)</label>
            <textarea
              name="content"
              defaultValue={sop?.content || ''}
              rows={15}
              placeholder="# Título del SOP&#10;&#10;## Paso 1&#10;Descripción del paso...&#10;&#10;## Paso 2&#10;..."
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 resize-y font-mono"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? 'Guardando...' : sop ? 'Actualizar' : 'Crear'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
