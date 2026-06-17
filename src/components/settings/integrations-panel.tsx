'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardTitle } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'
import { Link2, Unlink, ExternalLink, CheckCircle, AlertCircle } from 'lucide-react'
import type { Integration } from '@/lib/types'

interface PlatformConfig {
  name: string
  platformKey: string
  authUrl: string | null
  description: string
}

const PLATFORMS: PlatformConfig[] = [
  {
    name: 'Instagram (Meta)',
    platformKey: 'instagram',
    authUrl: '/api/integrations/meta/auth',
    description: 'Reels, Stories, métricas y mensajes directos',
  },
  {
    name: 'Manychat',
    platformKey: 'manychat',
    authUrl: null,
    description: 'Automatización de chats y bots',
  },
  {
    name: 'GoHighLevel',
    platformKey: 'gohighlevel',
    authUrl: null,
    description: 'CRM y pipelines externos',
  },
  {
    name: 'Fathom',
    platformKey: 'fathom',
    authUrl: null,
    description: 'Transcripciones y análisis de llamadas',
  },
]

const statusConfig: Record<string, { label: string; variant: 'success' | 'danger' | 'warning' | 'default' }> = {
  connected: { label: 'Conectado', variant: 'success' },
  disconnected: { label: 'Desconectado', variant: 'default' },
  error: { label: 'Error', variant: 'danger' },
  pending_review: { label: 'Pendiente', variant: 'warning' },
}

interface Props {
  integrations: Integration[]
}

export function IntegrationsPanel({ integrations }: Props) {
  const searchParams = useSearchParams()
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    if (searchParams.get('meta_connected') === 'true') {
      setToast({ type: 'success', message: 'Instagram (Meta) conectado exitosamente' })
    }
    const metaError = searchParams.get('meta_error')
    if (metaError) {
      setToast({ type: 'error', message: decodeURIComponent(metaError) })
    }
  }, [searchParams])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(timer)
  }, [toast])

  function getIntegration(platformKey: string): Integration | undefined {
    return integrations.find((i) => i.platform === platformKey)
  }

  function handleConnect(authUrl: string) {
    window.location.href = authUrl
  }

  function handleDisconnect(platformKey: string) {
    // TODO: Call API to revoke token and update integration status
    console.log('Disconnect:', platformKey)
  }

  return (
    <Card>
      <CardTitle>Integraciones</CardTitle>

      {toast && (
        <div className={`mt-3 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${
          toast.type === 'success'
            ? 'border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-300'
            : 'border-red-500/20 bg-red-500/[0.06] text-red-300'
        }`}>
          {toast.type === 'success'
            ? <CheckCircle className="h-4 w-4 shrink-0" />
            : <AlertCircle className="h-4 w-4 shrink-0" />
          }
          {toast.message}
        </div>
      )}

      <div className="mt-4 space-y-3">
        {PLATFORMS.map((platform) => {
          const integration = getIntegration(platform.platformKey)
          const isConnected = integration?.status === 'connected'
          const hasError = integration?.status === 'error'
          const status = integration ? statusConfig[integration.status] : null

          return (
            <div
              key={platform.platformKey}
              className={`flex items-center justify-between rounded-2xl border px-4 py-4 transition-all duration-300 ${
                isConnected
                  ? 'border-emerald-500/20 bg-emerald-500/[0.03]'
                  : hasError
                    ? 'border-red-500/20 bg-red-500/[0.03]'
                    : 'border-white/[0.05] bg-white/[0.02] hover:border-white/[0.08] hover:bg-white/[0.04]'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white/90">{platform.name}</p>
                  {status && <Badge variant={status.variant}>{status.label}</Badge>}
                </div>
                <p className="text-xs text-zinc-500">{platform.description}</p>
                {integration?.last_sync_at && (
                  <p className="text-xs text-zinc-600">
                    Último sync: {formatDate(integration.last_sync_at)}
                  </p>
                )}
                {integration?.last_error && (
                  <p className="text-xs text-red-400/80">{integration.last_error}</p>
                )}
              </div>

              <div>
                {isConnected ? (
                  <button
                    onClick={() => handleDisconnect(platform.platformKey)}
                    className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-zinc-400 transition-all duration-300 hover:border-red-500/30 hover:bg-red-500/[0.06] hover:text-red-300"
                  >
                    <Unlink className="h-3 w-3" />
                    Desconectar
                  </button>
                ) : platform.authUrl ? (
                  <button
                    onClick={() => handleConnect(platform.authUrl!)}
                    className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-white/90 transition-all duration-300 hover:border-white/[0.15] hover:bg-white/[0.1]"
                  >
                    <Link2 className="h-3 w-3" />
                    Conectar
                  </button>
                ) : (
                  <span className="flex items-center gap-1.5 rounded-xl border border-dashed border-white/[0.05] px-3 py-1.5 text-xs text-zinc-600">
                    <ExternalLink className="h-3 w-3" />
                    Próximamente
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
