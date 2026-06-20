'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClientAction, updateClientAction } from '@/lib/actions/clients'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import type { Client } from '@/lib/types'
import { X } from 'lucide-react'


const statusOptions = [
  { value: 'prospect', label: 'Prospecto' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'active', label: 'Activo' },
  { value: 'paused', label: 'Pausado' },
  { value: 'churned', label: 'Churned' },
]

interface ClientFormProps {
  client?: Client
  onClose: () => void
}

export function ClientForm({ client, onClose }: ClientFormProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const formData = new FormData(e.currentTarget)

    try {
      if (client) {
        await updateClientAction(client.id, formData)
      } else {
        await createClientAction(formData)
      }
      router.refresh()
      onClose()
    } catch {
      setError('Error al guardar el cliente')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal onClose={onClose} size="sm">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-zinc-50">
          {client ? 'Editar Cliente' : 'Nuevo Cliente'}
        </h2>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200">
          <X className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">

        <Input
          id="name"
          name="name"
          label="Nombre"
          placeholder="Saez Barber Academy"
          defaultValue={client?.name}
          required
        />
        <Input
          id="ig_handle"
          name="ig_handle"
          label="Handle de Instagram"
          placeholder="@saezbarber"
          defaultValue={client?.ig_handle}
          required
        />
        <Input
          id="industry"
          name="industry"
          label="Industria"
          placeholder="Barbería, Fitness, Coaching..."
          defaultValue={client?.industry || ''}
        />
        <Select
          id="status"
          name="status"
          label="Estado"
          options={statusOptions}
          defaultValue={client?.status || 'prospect'}
        />
        <div className="space-y-1.5">
          <Input
            id="ig_account_id"
            name="ig_account_id"
            label="Instagram Account ID"
            placeholder="17841400123456789"
            defaultValue={client?.ig_account_id || ''}
          />
          <p className="text-[11px] text-zinc-600 leading-snug">
            ID numérico de la cuenta de IG Business. Se usa para sincronizar Reels automáticamente.
          </p>
        </div>
        <Input
          id="monthly_fee"
          name="monthly_fee"
          label="Fee Mensual (USD)"
          type="number"
          step="0.01"
          placeholder="1500"
          defaultValue={client?.monthly_fee?.toString() || ''}
        />

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" disabled={loading} className="flex-1">
            {loading ? 'Guardando...' : client ? 'Actualizar' : 'Crear'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

