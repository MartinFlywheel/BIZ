'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { submitDailyReport, type CycleProgress } from '@/lib/actions/setter-app'

interface Props {
  userId: string
  clientId: string
  progress: CycleProgress
}

export function ReportForm({ userId, clientId, progress }: Props) {
  const [commonObjections, setCommonObjections] = useState('')
  const [marketingFeedback, setMarketingFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await submitDailyReport(userId, clientId, { commonObjections, marketingFeedback })
      router.push('/setter-app')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar el reporte — intenta de nuevo')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
        <p className="text-xs uppercase tracking-wider text-zinc-500 mb-3">Resumen automático</p>
        <div className="grid grid-cols-2 gap-3 text-center">
          <div>
            <p className="font-mono text-2xl font-semibold text-white">{progress.leadsTouched}</p>
            <p className="text-[11px] text-zinc-500">Leads tocados</p>
          </div>
          <div>
            <p className="font-mono text-2xl font-semibold text-emerald-400">{progress.agendasSet}</p>
            <p className="text-[11px] text-zinc-500">Agendas logradas</p>
          </div>
          {progress.followupsByStage.map((f) => (
            <div key={f.stage}>
              <p className="font-mono text-lg font-semibold text-white">{f.count}</p>
              <p className="text-[11px] text-zinc-500">Seguim. {f.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-zinc-300">¿Qué objeciones encontraste hoy?</label>
        <textarea
          value={commonObjections}
          onChange={(e) => setCommonObjections(e.target.value)}
          rows={3}
          placeholder="Ej: precio, tiempo, ya lo intentaron antes..."
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-zinc-300">Comentarios para marketing</label>
        <textarea
          value={marketingFeedback}
          onChange={(e) => setMarketingFeedback(e.target.value)}
          rows={3}
          placeholder="Qué está funcionando, qué no, ideas de contenido..."
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
        />
      </div>

      {error && (
        <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">{error}</p>
      )}

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? 'Enviando...' : 'Enviar reporte y continuar'}
      </Button>
    </form>
  )
}
