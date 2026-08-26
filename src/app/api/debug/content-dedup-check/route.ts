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

function isRealInstagramPermalink(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === 'www.instagram.com' || host === 'instagram.com'
  } catch {
    return false
  }
}

// Cleans up the "phantom" rows a past syncClientContent run created from
// Meta's duplicate reel-asset objects (see isRealInstagramPermalink in
// src/lib/actions/instagram.ts) — untagged, meta_api-sourced pieces whose
// ig_permalink isn't a real Instagram URL. Refuses to touch anything with
// content_metrics/interactions/leads attached, as a safety net.
export async function POST(request: Request) {
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

  const { data: candidates, error } = await supabase
    .from('content_pieces')
    .select('id, ig_permalink')
    .eq('client_id', clientId)
    .eq('metrics_source', 'meta_api')
    .is('keyword_trigger', null)
    .not('ig_permalink', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const phantomIds = (candidates || [])
    .filter((p) => !isRealInstagramPermalink(p.ig_permalink as string))
    .map((p) => p.id)

  if (phantomIds.length === 0) {
    return NextResponse.json({ deleted: 0, skipped_has_data: [], message: 'No phantom rows found' })
  }

  const [{ data: metrics }, { data: interactions }, { data: leads }] = await Promise.all([
    supabase.from('content_metrics').select('content_id').in('content_id', phantomIds),
    supabase.from('interactions').select('content_id').in('content_id', phantomIds),
    supabase.from('leads').select('content_id').in('content_id', phantomIds),
  ])
  const hasData = new Set([
    ...(metrics || []).map((m) => m.content_id),
    ...(interactions || []).map((i) => i.content_id),
    ...(leads || []).map((l) => l.content_id),
  ])

  const safeToDelete = phantomIds.filter((id) => !hasData.has(id))
  const skipped = phantomIds.filter((id) => hasData.has(id))

  if (safeToDelete.length > 0) {
    await supabase.from('content_notes').delete().in('content_id', safeToDelete)
    const { error: deleteError } = await supabase.from('content_pieces').delete().in('id', safeToDelete)
    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ deleted: safeToDelete.length, skipped_has_data: skipped })
}
