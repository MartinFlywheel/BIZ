import { NextResponse, type NextRequest } from 'next/server'
import { getAppUrl } from '@/lib/env'

// Never cache — token exchange must run at request time on Vercel.
export const dynamic = 'force-dynamic'

interface ShortLivedTokenResponse {
  access_token: string
  token_type: string
}

interface LongLivedTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
}

export async function GET(request: NextRequest) {
  const appUrl = getAppUrl()
  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  const { searchParams } = request.nextUrl

  const code = searchParams.get('code')
  const errorParam = searchParams.get('error')

  if (errorParam) {
    const errorDesc = searchParams.get('error_description') || 'User denied access'
    return NextResponse.redirect(
      `${appUrl}/settings?meta_error=${encodeURIComponent(errorDesc)}`
    )
  }

  if (!code) {
    return NextResponse.redirect(
      `${appUrl}/settings?meta_error=${encodeURIComponent('No authorization code received')}`
    )
  }

  if (!appId || !appSecret) {
    return NextResponse.redirect(
      `${appUrl}/settings?meta_error=${encodeURIComponent('Server configuration missing')}`
    )
  }

  const redirectUri = `${appUrl}/api/integrations/meta/callback`

  try {
    // Step 1: Exchange code for short-lived token
    const tokenParams = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code,
    })

    const shortLivedRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?${tokenParams.toString()}`
    )

    if (!shortLivedRes.ok) {
      const errorBody = await shortLivedRes.text()
      throw new Error(`Token exchange failed: ${errorBody}`)
    }

    const shortLivedData: ShortLivedTokenResponse = await shortLivedRes.json()

    // Step 2: Exchange short-lived token for long-lived token (60 days)
    const longLivedParams = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortLivedData.access_token,
    })

    const longLivedRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?${longLivedParams.toString()}`
    )

    if (!longLivedRes.ok) {
      const errorBody = await longLivedRes.text()
      throw new Error(`Long-lived token exchange failed: ${errorBody}`)
    }

    const longLivedData: LongLivedTokenResponse = await longLivedRes.json()

    const expiresAt = new Date()
    expiresAt.setSeconds(expiresAt.getSeconds() + longLivedData.expires_in)

    // TODO: Guardar en Supabase
    // await supabaseAdmin.from('integrations').upsert({
    //   client_id: clientId,
    //   platform: 'instagram',
    //   access_token: longLivedData.access_token,
    //   token_expires_at: expiresAt.toISOString(),
    //   status: 'connected',
    //   last_sync_at: new Date().toISOString(),
    // }, { onConflict: 'client_id,platform' })

    console.log('[Meta OAuth] Long-lived token obtained, expires:', expiresAt.toISOString())

    return NextResponse.redirect(`${appUrl}/settings?meta_connected=true`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Meta OAuth] Error:', message)
    return NextResponse.redirect(
      `${appUrl}/settings?meta_error=${encodeURIComponent(message)}`
    )
  }
}
