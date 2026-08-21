import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paginate'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// One-time catch-up: the auto-assignment feature only fires on NEW webhook
// events, and the old base ManyChat webhook (src/app/api/webhooks/manychat/
// route.ts) never had it at all until now — so a real backlog of leads
// that already reached conversación real / lead calificado sat
// permanently unassigned. This walks every such lead once, figures out
// their real classification the same way the CRM's own "Tipo de
// interacción" filter does (fallback match by client_id + ig_username,
// since the old route also never linked leads.interaction_id), and
// assigns a setter with the same weighted load-balancing rule as live
// traffic. Safe to re-run — only ever touches leads where assigned_to is
// still null.
const RANK: Record<string, number> = { lead_calificado: 2, conversacion_real: 1 }

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const validSecrets = [process.env.CRON_SECRET, process.env.BACKFILL_SECRET].filter(Boolean)
  if (!validSecrets.some((s) => authHeader === `Bearer ${s}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  const [leads, interactions] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from('leads')
        .select('id, client_id, ig_username, interaction_id')
        .is('assigned_to', null)
        .not('ig_username', 'is', null)
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from('interactions')
        .select('id, client_id, ig_username, classification')
        .in('classification', ['conversacion_real', 'lead_calificado'])
        .range(from, to)
    ),
  ])

  // Best (highest-rank) classification + a matching interaction id, per
  // client_id + lowercased ig_username. Fetched in bulk up front so the
  // per-lead loop below never needs its own DB round trip (that per-lead
  // query was the reason this endpoint originally blew past Vercel's
  // function timeout on a real-sized backlog).
  const bestByKey = new Map<string, { classification: string; interactionId: string }>()
  for (const i of interactions) {
    if (!i.ig_username) continue
    const key = `${i.client_id}:${i.ig_username.toLowerCase()}`
    const current = bestByKey.get(key)
    if (!current || RANK[i.classification] > RANK[current.classification]) {
      bestByKey.set(key, { classification: i.classification, interactionId: i.id })
    }
  }

  const qualifying = leads.filter((l) => {
    const key = `${l.client_id}:${l.ig_username!.toLowerCase()}`
    return bestByKey.has(key)
  })

  // Group by client so the setter roster + current load is fetched once
  // per client instead of once per lead.
  const byClient = new Map<string, typeof qualifying>()
  for (const lead of qualifying) {
    const list = byClient.get(lead.client_id) ?? []
    list.push(lead)
    byClient.set(lead.client_id, list)
  }

  const results: Array<{ client_id: string; qualifying: number; assigned: number; skipped_no_setters: number }> = []

  for (const [clientId, clientLeads] of byClient) {
    const { data: setters } = await supabase
      .from('users')
      .select('id, lead_weight')
      .eq('user_type', 'agency')
      .eq('is_active', true)
      .eq('client_id', clientId)
      .eq('role', 'setter')

    if (!setters || setters.length === 0) {
      results.push({ client_id: clientId, qualifying: clientLeads.length, assigned: 0, skipped_no_setters: clientLeads.length })
      continue
    }

    const { data: assignedLeads } = await supabase
      .from('leads')
      .select('assigned_to')
      .eq('client_id', clientId)
      .in('assigned_to', setters.map((s) => s.id))

    const counts = new Map<string, number>(setters.map((s) => [s.id, 0]))
    for (const row of assignedLeads || []) {
      if (row.assigned_to) counts.set(row.assigned_to, (counts.get(row.assigned_to) || 0) + 1)
    }

    // The round-robin ratio depends on running counts, so picking the
    // setter per lead must stay sequential — but the actual writes don't
    // depend on each other, so they're fired in parallel batches instead
    // of one at a time.
    const pending: PromiseLike<unknown>[] = []
    for (const lead of clientLeads) {
      let bestRatio = Infinity
      let candidates: string[] = []
      for (const s of setters) {
        const ratio = (counts.get(s.id) || 0) / (s.lead_weight || 1)
        if (ratio < bestRatio) { bestRatio = ratio; candidates = [s.id] }
        else if (ratio === bestRatio) candidates.push(s.id)
      }
      const setterId = candidates[Math.floor(Math.random() * candidates.length)]

      const key = `${clientId}:${lead.ig_username!.toLowerCase()}`
      const updates: Record<string, unknown> = { assigned_to: setterId }
      if (!lead.interaction_id) {
        const match = bestByKey.get(key)
        if (match) updates.interaction_id = match.interactionId
      }

      pending.push(supabase.from('leads').update(updates).eq('id', lead.id))
      counts.set(setterId, (counts.get(setterId) || 0) + 1)
    }

    const BATCH_SIZE = 25
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      await Promise.all(pending.slice(i, i + BATCH_SIZE))
    }

    results.push({ client_id: clientId, qualifying: clientLeads.length, assigned: pending.length, skipped_no_setters: 0 })
  }

  return NextResponse.json({
    total_unassigned_checked: leads.length,
    total_qualifying: qualifying.length,
    results,
  })
}
