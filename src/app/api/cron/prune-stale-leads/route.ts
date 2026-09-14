import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logCronRun } from '@/lib/cron-log'
import { fetchAllRowsByCursor } from '@/lib/supabase/paginate'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STALE_DAYS = 30
// Tope por corrida y tamaño de lote. Con ~2.800 ids en un solo `.in()` la URL
// de PostgREST pasaba de 100 KB, la operación fallaba y el cron registraba 0
// sin avisar. Sin tope, arreglar eso habría borrado miles de leads de golpe.
const MAX_BORRADOS_POR_CORRIDA = 300
const LOTE = 150

// Runs once a day (vercel.json). Borra leads en "nuevo_contacto" que nunca
// avanzaron de etapa, tocaron como mucho 1 CTA (pieza de contenido) en toda
// su historia, y esa única interacción ya tiene más de 30 días — leads que
// nunca dieron señales de interés real más allá del primer click y solo
// acumulan espacio. Cualquier otra etapa, o haber tocado 2+ piezas
// distintas, los deja afuera del borrado.
//
// Solo se limpian leads que entraron por ManyChat (o sin origen registrado):
// los de lead magnet, landing o agente entran por otro flujo y se borraban el
// mismo día en que llegaban. Nunca se toca un lead con agenda, llamada, alumna
// o seguimiento: esas FK son ON DELETE CASCADE y se llevaban datos de venta.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: clients } = await supabase.from('clients').select('id')
  if (!clients || clients.length === 0) {
    await logCronRun('prune-stale-leads', { borrados: 0, clientesRevisados: 0, motivo: 'sin clientes' })
    return NextResponse.json({ status: 'no_clients', deleted: 0 })
  }

  let totalDeleted = 0
  const perClient: Record<string, number> = {}
  const errores: string[] = []

  for (const client of clients) {
    const leads = await fetchAllRowsByCursor<{ id: string; ig_username: string | null }>((cursor, limit) => {
      let query = supabase
        .from('leads')
        .select('id, ig_username')
        .eq('client_id', client.id)
        .eq('stage', 'nuevo_contacto')
        // Los leads creados por la API del agente no tienen interacciones
        // de ManyChat ni usuario de Instagram, así que esta limpieza los
        // tomaría por basura y los borraría la primera noche. Se excluyen.
        // El `is.null` es necesario: un NOT LIKE sobre NULL no es verdadero
        // y dejaría de limpiar los leads sin origen registrado.
        .or('first_touch_type.is.null,first_touch_type.like.manychat:%')
        // Un lead recién creado sin interacción todavía no es basura.
        .lt('created_at', cutoff)
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

    // Leads con trabajo encima: se conservan aunque sigan en nuevo_contacto. Si
    // no se puede confirmar cuáles son, fetchAllRowsByCursor lanza y la corrida
    // termina sin tocar nada.
    const protegidos = new Set<string>()
    for (const tabla of ['agenda_records', 'sales_calls', 'program_students', 'lead_activity_logs'] as const) {
      const filas = await fetchAllRowsByCursor<{ id: string; lead_id: string | null }>((cursor, limit) => {
        let query = supabase
          .from(tabla)
          .select('id, lead_id')
          .not('lead_id', 'is', null)
          .order('id', { ascending: true })
          .limit(limit)
        if (cursor) query = query.gt('id', cursor)
        return query
      })
      for (const f of filas) if (f.lead_id) protegidos.add(f.lead_id)
    }

    const aBorrar = staleIds
      .filter((id) => !protegidos.has(id))
      .slice(0, Math.max(0, MAX_BORRADOS_POR_CORRIDA - totalDeleted))
    if (aBorrar.length === 0) continue

    let borradosCliente = 0
    for (let i = 0; i < aBorrar.length; i += LOTE) {
      const lote = aBorrar.slice(i, i + LOTE)
      const { error } = await supabase.from('leads').delete().in('id', lote)
      if (error) {
        console.error(`[PruneStaleLeads] delete failed for client ${client.id}:`, error.message)
        errores.push(`${client.id}: ${error.message}`)
        break
      }
      borradosCliente += lote.length
    }
    totalDeleted += borradosCliente
    perClient[client.id] = borradosCliente
    if (totalDeleted >= MAX_BORRADOS_POR_CORRIDA) break
  }

  // Pasa por el helper compartido (src/lib/cron-log.ts) igual que el resto de
  // los crons: el insert directo que había acá descartaba el error de Supabase
  // sin mirarlo, así que si la tabla no existía el registro se perdía en
  // silencio — que fue exactamente lo que pasó hasta que se corrió 032.
  await logCronRun('prune-stale-leads', {
    borrados: totalDeleted,
    clientesRevisados: clients.length,
    porCliente: perClient,
    tope: MAX_BORRADOS_POR_CORRIDA,
    ...(errores.length > 0 && { errores }),
  })

  return NextResponse.json({ status: 'completed', deleted: totalDeleted, perClient })
}
