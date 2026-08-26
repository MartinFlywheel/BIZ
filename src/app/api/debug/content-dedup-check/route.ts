import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Temporary read-only diagnostic for the syncClientContent duplicate
// investigation — dumps every content_pieces row for a client so the
// manual-vs-synced pairing can be inspected by hand. Delete once the
// dedup incident is resolved.
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
    .select('id, content_type, caption, keyword_trigger, ig_media_id, ig_permalink, published_at, metrics_source, views, likes, created_at')
    .eq('client_id', clientId)
    .order('published_at', { ascending: false, nullsFirst: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = (pieces || []).map((p) => p.id)
  const [{ data: metrics }, { data: interactions }, { data: leads }] = await Promise.all([
    supabase.from('content_metrics').select('content_id, cierres, cash_collected').in('content_id', ids),
    supabase.from('interactions').select('id, content_id').in('content_id', ids),
    supabase.from('leads').select('id, content_id').in('content_id', ids),
  ])

  return NextResponse.json({
    count: pieces?.length ?? 0,
    pieces,
    content_metrics: metrics,
    interactions_by_content: interactions,
    leads_by_content: leads,
  })
}
