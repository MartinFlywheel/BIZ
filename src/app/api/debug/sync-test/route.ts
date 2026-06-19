import { NextResponse, type NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const token = process.env.META_SYSTEM_USER_TOKEN
  const { searchParams } = request.nextUrl
  const igAccountId = searchParams.get('ig_account_id')

  const checks: Record<string, unknown> = {
    meta_system_token: token ? `SET (${token.substring(0, 10)}...)` : 'MISSING',
    ig_account_id: igAccountId || 'NOT PROVIDED (add ?ig_account_id=YOUR_ID)',
  }

  if (!token) {
    return NextResponse.json({ ...checks, error: 'META_SYSTEM_USER_TOKEN not set' }, { status: 500 })
  }

  if (!igAccountId) {
    const meRes = await fetch(`https://graph.instagram.com/me?fields=id,username&access_token=${token}`)
    const meData = await meRes.json()
    checks.token_check = meRes.ok ? meData : { error: meData.error?.message || `HTTP ${meRes.status}` }

    if (meRes.ok && meData.id) {
      const mediaRes = await fetch(
        `https://graph.instagram.com/${meData.id}/media?fields=id,caption,media_type,permalink,timestamp&limit=3&access_token=${token}`
      )
      const mediaData = await mediaRes.json()
      checks.media_test = mediaRes.ok
        ? { count: mediaData.data?.length || 0, sample: mediaData.data?.slice(0, 2) }
        : { error: mediaData.error?.message || `HTTP ${mediaRes.status}` }
    }

    return NextResponse.json(checks)
  }

  const mediaRes = await fetch(
    `https://graph.instagram.com/${igAccountId}/media?fields=id,caption,media_type,permalink,timestamp&limit=5&access_token=${token}`
  )
  const mediaData = await mediaRes.json()

  if (!mediaRes.ok) {
    checks.api_error = mediaData.error || { status: mediaRes.status, body: mediaData }
    return NextResponse.json(checks, { status: 400 })
  }

  checks.media_found = mediaData.data?.length || 0
  checks.sample = mediaData.data?.slice(0, 3)

  return NextResponse.json(checks)
}
