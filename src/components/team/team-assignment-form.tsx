'use client'

import { useState } from 'react'
import { createAssignmentAction } from '@/lib/actions/team'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { X } from 'lucide-react'


interface Props {
  clientId: string
  users: { id: string; full_name: string; email: string; role: string }[]
  onClose: () => void
}

export function TeamAssignmentForm({ clientId, users, onClose }: Props) {
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    const formData = new FormData(e.currentTarget)
    formData.set('client_id', clientId)
    await createAssignmentAction(formData)
    setLoading(false)
    onClose()
  }

  return (
    <Modal onClose={onClose} size="sm">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-zinc-50">Asignar Miembro</h2>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200"><X className="h-5 w-5" /></button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Select id="user_id" name="user_id" label="Miembro del Equipo" options={
          users.map((u) => ({ value: u.id, label: `${u.full_name} (${u.role})` }))
        } />
        <Select id="responsibility" name="responsibility" label="Responsabilidad" options={[
          { value: 'content', label: 'Contenido' },
          { value: 'setting', label: 'Setting (Pre-cualificación)' },
          { value: 'closing', label: 'Closing (Ventas)' },
          { value: 'strategy', label: 'Estrategia' },
        ]} />
        <div className="flex items-center gap-2">
          <input type="checkbox" id="is_primary" name="is_primary" value="true" className="rounded border-zinc-700 bg-zinc-800" />
          <label htmlFor="is_primary" className="text-sm text-zinc-300">Responsable principal</label>
        </div>
        <div className="flex gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button type="submit" disabled={loading} className="flex-1">{loading ? 'Asignando...' : 'Asignar'}</Button>
        </div>
      </form>
    </Modal>
  )
}

