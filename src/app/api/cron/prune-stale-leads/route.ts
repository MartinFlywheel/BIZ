import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRowsByCursor } from '@/lib/supabase/paginate'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STALE_DAYS = 30

// Runs once a day (vercel.json). Borra leads en "nuevo_contacto" que nunca
// avanzaron de etapa, tocaron como mucho 1 CTA (pieza de contenido) en toda
// su historia, y esa única interacción ya tiene más de 30 días — leads que
// nunca dieron señales de interés real más allá del primer click y solo
// acumulan espacio. Cualquier otra etapa, o haber tocado 2+ piezas
// distintas, los deja afuera del borrado.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: clients } = await supabase.from('clients').select('id')
  if (!clients || clients.length === 0) {
    return NextResponse.json({ status: 'no_clients', deleted: 0 })
  }

  let totalDeleted = 0
  const perClient: Record<string, number> = {}

  for (const client of clients) {
    const leads = await fetchAllRowsByCursor<{ id: string; ig_username: string | null }>((cursor, limit) => {
      let query = supabase
        .from('leads')
        .select('id, ig_username')
        .eq('client_id', client.id)
        .eq('stage', 'nuevo_contacto')
        .order('id', { ascending: true })
        .limit(limit)
      if (cursor) query = query.gt('id', cursor)
      return query
    })
    if (leads.length === 0) continue

    const interactions = await fetchAllRowsByCursor<{ id: string; ig_username: string | null; bot_triggered_at: string }>((cursor, limit) => {
      let query = supabase
        .from('interactions')
        .select('id, ig_username, bot_triggered_at')
        .eq('client_id', client.id)
        .order('id', { ascending: true })
        .limit(limit)
      if (cursor) query = query.gt('id', cursor)
      return query
    })

    // Por username: cuántas piezas distintas tocó y cuándo fue la última.
    const touchesByUsername = new Map<string, { count: number; lastTouch: string }>()
    for (const i of interactions) {
      if (!i.ig_username) continue
      const key = i.ig_username.toLowerCase()
      const existing = touchesByUsername.get(key)
      if (!existing) {
        touchesByUsername.set(key, { count: 1, lastTouch: i.bot_triggered_at })
      } else {
        existing.count += 1
        if (i.bot_triggered_at > existing.lastTouch) existing.lastTouch = i.bot_triggered_at
      }
    }

    const staleIds = leads
      .filter((l) => {
        const touch = l.ig_username ? touchesByUsername.get(l.ig_username.toLowerCase()) : undefined
        if (!touch) return true // ninguna interacción registrada — igual de "junk"
        if (touch.count > 1) return false // tocó más de 1 CTA, no se borra
        return touch.lastTouch < cutoff
      })
      .map((l) => l.id)

    if (staleIds.length === 0) continue

    const { error } = await supabase.from('leads').delete().in('id', staleIds)
    if (error) {
      console.error(`[PruneStaleLeads] delete failed for client ${client.id}:`, error.message)
      continue
    }
    totalDeleted += staleIds.length
    perClient[client.id] = staleIds.length
  }

  // Vercel's runtime logs on this project only retain a few hours, and the
  // route's own response is otherwise unrecoverable once that window
  // passes — persist a summary so "did it delete anything?" is answerable
  // anytime, not just right after a run.
  await supabase.from('cron_runs').insert({
    job_name: 'prune-stale-leads',
    summary: { deleted: totalDeleted, clientsScanned: clients.length, perClient },
  })

  return NextResponse.json({ status: 'completed', deleted: totalDeleted, perClient })
}
