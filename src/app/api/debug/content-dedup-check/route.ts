import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Temporary — round 2 of the content_pieces reconciliation for Mane's
// client. Dumps every row so the remaining unmatched tagged pieces (likely
// off by one day from their real post due to UTC vs local publish time)
// can be paired up precisely before merging. Delete once resolved.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const validSecrets = [process.env.CRON_SECRET, process.env.BACKFILL_SECRET].filter(Boolean)
  if (!validSecrets.some((s) => authHeader === `Bearer ${s}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('client_id')
  if (!clientId) {
    return NextResponse.json({ error: 'client_id query param required' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: pieces, error } = await supabase
    .from('content_pieces')
    .select('id, content_type, caption, keyword_trigger, ig_media_id, ig_permalink, ig_thumbnail_url, published_at, metrics_source, views, likes, comments, created_at')
    .eq('client_id', clientId)
    .order('published_at', { ascending: false, nullsFirst: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = (pieces || []).map((p) => p.id)
  const { data: metrics } = await supabase.from('content_metrics').select('content_id, cierres, cash_collected').in('content_id', ids)

  return NextResponse.json({ count: pieces?.length ?? 0, pieces, content_metrics: metrics })
}
