import { NextResponse } from 'next/server'
import { getAppUrl } from '@/lib/env'

// Never cache — OAuth init must always run server-side at request time.
export const dynamic = 'force-dynamic'

const SCOPES = [
  'instagram_basic',
  'instagram_manage_messages',
  'instagram_manage_comments',
  'pages_show_list',
  'pages_read_engagement',
  'business_management',
].join(',')

export async function GET() {
  const appUrl = getAppUrl()
  const appId = process.env.META_APP_ID

  if (!appId) {
    return NextResponse.json(
      { error: 'META_APP_ID not configured' },
      { status: 500 }
    )
  }

  const redirectUri = `${appUrl}/api/integrations/meta/callback`

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    response_type: 'code',
    state: crypto.randomUUID(),
  })

  const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`

  return NextResponse.redirect(authUrl)
}
