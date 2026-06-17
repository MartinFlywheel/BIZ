import { createClient } from '@/lib/supabase/server'
import { NotificationsList } from '@/components/notifications/notifications-list'

export default async function NotificationsPage() {
  const supabase = await createClient()

  const { data: notifications } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <div className="space-y-6">
      <NotificationsList notifications={notifications || []} />
    </div>
  )
}
