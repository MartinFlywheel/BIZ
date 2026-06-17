'use client'

import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/client'
import { formatRelativeTime } from '@/lib/utils'
import { Bell, AlertTriangle, CheckCircle, Info } from 'lucide-react'
import type { Notification } from '@/lib/types'

const severityConfig: Record<string, { icon: typeof Bell; variant: 'danger' | 'warning' | 'info' | 'default'; color: string }> = {
  critical: { icon: AlertTriangle, variant: 'danger', color: 'text-red-400' },
  warning: { icon: Bell, variant: 'warning', color: 'text-amber-400' },
  info: { icon: Info, variant: 'info', color: 'text-blue-400' },
}

export function NotificationsList({ notifications }: { notifications: Notification[] }) {
  const router = useRouter()
  const unreadCount = notifications.filter((n) => !n.is_read).length

  async function markAsRead(id: string) {
    const supabase = createClient()
    await supabase.from('notifications').update({ is_read: true }).eq('id', id)
    router.refresh()
  }

  async function markAllAsRead() {
    const supabase = createClient()
    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id)
    if (unreadIds.length === 0) return
    await supabase.from('notifications').update({ is_read: true }).in('id', unreadIds)
    router.refresh()
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">Notificaciones</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {unreadCount > 0 ? `${unreadCount} sin leer` : 'Todo al día'}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllAsRead}
            className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Marcar todas como leídas
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <Card>
          <div className="flex h-48 items-center justify-center text-zinc-500">
            <div className="text-center">
              <CheckCircle className="h-8 w-8 mx-auto mb-2 text-zinc-600" />
              <p>No hay notificaciones</p>
            </div>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => {
            const config = severityConfig[n.severity] || severityConfig.info
            const Icon = config.icon
            return (
              <Card
                key={n.id}
                className={`p-4 cursor-pointer transition-colors ${
                  n.is_read ? 'opacity-60' : 'hover:border-zinc-700'
                }`}
                onClick={() => !n.is_read && markAsRead(n.id)}
              >
                <div className="flex items-start gap-3">
                  <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${config.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-zinc-100">{n.title}</p>
                      <Badge variant={config.variant}>{n.type}</Badge>
                      {!n.is_read && (
                        <span className="h-2 w-2 rounded-full bg-blue-500" />
                      )}
                    </div>
                    {n.body && (
                      <p className="mt-1 text-sm text-zinc-400 leading-relaxed">{n.body}</p>
                    )}
                    <p className="mt-1 text-xs text-zinc-600">{formatRelativeTime(n.created_at)}</p>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}
