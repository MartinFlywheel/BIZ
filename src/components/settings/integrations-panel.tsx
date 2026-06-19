'use client'

import { Badge } from '@/components/ui/badge'
import { Card, CardTitle } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'
import { ShieldCheck, ExternalLink } from 'lucide-react'
import type { Integration } from '@/lib/types'

interface PlatformConfig {
  name: string
  platformKey: string
  description: string
  /** Si true, la integración se gestiona vía System Token en el backend (sin OAuth manual). */
  systemManaged?: boolean
}

const PLATFORMS: PlatformConfig[] = [
  {
    name: 'Instagram (Meta)',
    platformKey: 'instagram',
    description: 'Reels, Stories, métricas y mensajes directos',
    systemManaged: true,
  },
  {
    name: 'Manychat',
    platformKey: 'manychat',
    description: 'Automatización de chats y bots',
  },
  {
    name: 'GoHighLevel',
    platformKey: 'gohighlevel',
    description: 'CRM y pipelines externos',
  },
  {
    name: 'Fathom',
    platformKey: 'fathom',
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
  function getIntegration(platformKey: string): Integration | undefined {
    return integrations.find((i) => i.platform === platformKey)
  }

  return (
    <Card>
      <CardTitle>Integraciones</CardTitle>

      <div className="mt-4 space-y-3">
        {PLATFORMS.map((platform) => {
          const integration = getIntegration(platform.platformKey)
          const isConnected = integration?.status === 'connected'
          const hasError = integration?.status === 'error'
          const status = integration ? statusConfig[integration.status] : null

          return (
            <div
              key={platform.platformKey}
              className={`flex items-center justify-between rounded-2xl border px-4 py-4 transition-all duration-300 ${isConnected
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
                {platform.systemManaged ? (
                  <span className="flex items-center gap-1.5 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-1.5 text-xs font-medium text-emerald-300">
                    <ShieldCheck className="h-3 w-3" />
                    System Token
                  </span>
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

      <p className="mt-4 text-xs text-zinc-600">
        Instagram se sincroniza automáticamente con el System User Token. Vincula cada cuenta desde el
        hub de su cliente (Instagram Account ID).
      </p>
    </Card>
  )
}
