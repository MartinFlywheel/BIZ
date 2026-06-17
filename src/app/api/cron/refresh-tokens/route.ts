import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Cron endpoint — must run at request time, never cached.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const supabaseAdmin = createAdminClient()
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sevenDaysFromNow = new Date()
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7)

  const { data: expiring } = await supabaseAdmin
    .from('integrations')
    .select('*')
    .eq('status', 'connected')
    .not('token_expires_at', 'is', null)
    .lte('token_expires_at', sevenDaysFromNow.toISOString())

  if (!expiring || expiring.length === 0) {
    return NextResponse.json({ status: 'no_expiring_tokens' })
  }

  const results = []

  for (const integration of expiring) {
    if (integration.platform === 'instagram' && integration.access_token) {
      try {
        const res = await fetch(
          `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${integration.access_token}`
        )

        if (!res.ok) throw new Error(`Refresh failed: ${res.status}`)

        const data = await res.json()

        const newExpiry = new Date()
        newExpiry.setSeconds(newExpiry.getSeconds() + (data.expires_in || 5184000))

        await supabaseAdmin
          .from('integrations')
          .update({
            access_token: data.access_token,
            token_expires_at: newExpiry.toISOString(),
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', integration.id)

        await supabaseAdmin.from('sync_logs').insert({
          integration_id: integration.id,
          sync_type: 'token_refresh',
          status: 'completed',
          completed_at: new Date().toISOString(),
        })

        results.push({ id: integration.id, platform: integration.platform, status: 'refreshed' })
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error'
        await supabaseAdmin
          .from('integrations')
          .update({ status: 'error', last_error: msg })
          .eq('id', integration.id)

        await supabaseAdmin.from('sync_logs').insert({
          integration_id: integration.id,
          sync_type: 'token_refresh',
          status: 'failed',
          error: msg,
          completed_at: new Date().toISOString(),
        })

        const { data: admins } = await supabaseAdmin
          .from('users')
          .select('id')
          .eq('role', 'admin')
          .eq('is_active', true)

        for (const admin of admins || []) {
          await supabaseAdmin.from('notifications').insert({
            user_id: admin.id,
            title: `Token de ${integration.platform} falló al refrescar`,
            body: msg,
            type: 'alert',
            severity: 'critical',
          })
        }

        results.push({ id: integration.id, platform: integration.platform, status: 'error', error: msg })
      }
    }
  }

  return NextResponse.json({ results })
}
