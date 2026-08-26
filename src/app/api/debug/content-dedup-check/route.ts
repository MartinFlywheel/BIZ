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

// One-time merge for the 6 tagged pieces whose real post landed on the
// adjacent UTC day (local publish time rolling the UTC date) — pairs
// confirmed by hand against the GET dump above, with the untagged
// duplicate side verified to carry no content_metrics/leads/interactions.
// Keeps the tagged row's id (and whatever revenue is linked to it),
// copies the real post's ig_media_id/permalink/metrics onto it, deletes
// the duplicate. Delete this route once run.
const MERGE_PAIRS: { keyword_trigger: string; taggedId: string; realId: string }[] = [
  { keyword_trigger: 'C_25_08', taggedId: '4ae06c85-8879-4287-8cf8-49a7de1b29d9', realId: '39ed6744-ab6d-45f9-b7d3-ca77621d5c80' },
  { keyword_trigger: 'C_21_08', taggedId: '35487431-c6aa-45ca-b3bc-b8e48427d198', realId: 'ec6e8887-dad2-4323-af26-96fc21fda297' },
  { keyword_trigger: 'R_10_08', taggedId: '6038c97e-0db4-4dbc-bae3-97cd4f4bf885', realId: '47200334-fcb9-462a-b6e8-72e8c9037b10' },
  { keyword_trigger: 'C_07_08', taggedId: 'cba5127e-d2b7-4ee8-ae8f-2cda35df651f', realId: 'a15076a5-fe66-4827-8645-a65d0fe5707a' },
  { keyword_trigger: 'R_30_07', taggedId: '87f2ea18-4779-498c-92ff-47364b140400', realId: '1aea358e-8824-4240-9059-ed252834310e' },
  { keyword_trigger: 'R_28_07', taggedId: 'ed8404eb-9ee9-4fac-8c93-0ae16406ca77', realId: 'a4cbebc2-a237-482a-8f31-0c6bddd8dc2a' },
]

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  const validSecrets = [process.env.CRON_SECRET, process.env.BACKFILL_SECRET].filter(Boolean)
  if (!validSecrets.some((s) => authHeader === `Bearer ${s}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const results: { keyword_trigger: string; status: string }[] = []

  for (const pair of MERGE_PAIRS) {
    const { data: real, error: fetchError } = await supabase
      .from('content_pieces')
      .select('ig_media_id, ig_permalink, ig_thumbnail_url, views, reach, likes, comments, shares, saves, total_interactions, avg_watch_time_seconds')
      .eq('id', pair.realId)
      .maybeSingle()

    if (fetchError || !real) {
      results.push({ keyword_trigger: pair.keyword_trigger, status: `skipped: real row not found (${fetchError?.message ?? 'missing'})` })
      continue
    }

    // Safety re-check right before deleting, same as the earlier phantom cleanup.
    const [{ data: metrics }, { data: interactions }, { data: leads }] = await Promise.all([
      supabase.from('content_metrics').select('content_id').eq('content_id', pair.realId),
      supabase.from('interactions').select('id').eq('content_id', pair.realId),
      supabase.from('leads').select('id').eq('content_id', pair.realId),
    ])
    if ((metrics?.length ?? 0) + (interactions?.length ?? 0) + (leads?.length ?? 0) > 0) {
      results.push({ keyword_trigger: pair.keyword_trigger, status: 'skipped: real row has attached data' })
      continue
    }

    const { error: updateError } = await supabase
      .from('content_pieces')
      .update({
        ig_media_id: real.ig_media_id,
        ig_permalink: real.ig_permalink,
        ig_thumbnail_url: real.ig_thumbnail_url,
        views: real.views,
        reach: real.reach,
        likes: real.likes,
        comments: real.comments,
        shares: real.shares,
        saves: real.saves,
        total_interactions: real.total_interactions,
        avg_watch_time_seconds: real.avg_watch_time_seconds,
        metrics_source: 'meta_api',
        metrics_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', pair.taggedId)
      .is('ig_media_id', null)

    if (updateError) {
      results.push({ keyword_trigger: pair.keyword_trigger, status: `error updating tagged row: ${updateError.message}` })
      continue
    }

    await supabase.from('content_notes').delete().eq('content_id', pair.realId)
    const { error: deleteError } = await supabase.from('content_pieces').delete().eq('id', pair.realId)
    if (deleteError) {
      results.push({ keyword_trigger: pair.keyword_trigger, status: `merged but delete of duplicate failed: ${deleteError.message}` })
      continue
    }

    results.push({ keyword_trigger: pair.keyword_trigger, status: 'merged' })
  }

  return NextResponse.json({ results })
}
