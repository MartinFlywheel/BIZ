import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// One-off verification tool: reproduces the same per-CTA breakdown Martin
// tracks externally (CTA, Total agendas, Cerrado, No Cerrado, No Show,
// Ingresos) from this app's own agenda_records + content_pieces, so it can
// be diffed against that external reference without DB access.
function normalizeCta(raw: string | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim().replace(/^manychat:/i, '')
  return trimmed || null
}

export async function GET(request: Request) {
  const supabase = createAdminClient()
  const clientName = new URL(request.url).searchParams.get('client')
  if (!clientName) return NextResponse.json({ error: 'Missing ?client= (matches clients.name, case-insensitive substring)' }, { status: 400 })

  const { data: clients, error: clientErr } = await supabase
    .from('clients')
    .select('id, name')
    .ilike('name', `%${clientName}%`)

  if (clientErr) return NextResponse.json({ error: clientErr.message }, { status: 500 })
  if (!clients || clients.length === 0) return NextResponse.json({ error: 'No client matched', query: clientName })
  if (clients.length > 1) return NextResponse.json({ error: 'Multiple clients matched, be more specific', matches: clients })

  const client = clients[0]

  const { data: pieces } = await supabase
    .from('content_pieces')
    .select('id, keyword_trigger, caption, content_type')
    .eq('client_id', client.id)

  const { data: agendas } = await supabase
    .from('agenda_records')
    .select('lead_id, de_donde_vino, estado, monto_facturacion, monto_upfront')
    .eq('client_id', client.id)

  const leadIds = Array.from(new Set((agendas || []).map((a) => a.lead_id).filter((id): id is string => !!id)))
  const { data: leadsForAgendas } = leadIds.length > 0
    ? await supabase.from('leads').select('id, first_touch_content_id').in('id', leadIds)
    : { data: [] }
  const contentIdByLeadId = Object.fromEntries(
    (leadsForAgendas || []).filter((l) => l.first_touch_content_id).map((l) => [l.id, l.first_touch_content_id as string])
  )

  const keywordTriggerToContentId = Object.fromEntries(
    (pieces || []).filter((p) => p.keyword_trigger).map((p) => [p.keyword_trigger as string, p.id])
  )
  const pieceById = new Map((pieces || []).map((p) => [p.id, p]))

  interface Row {
    cta: string
    content_id: string | null
    total: number
    cerrado: number
    no_cerrado: number
    no_show: number
    otros: number
    ingresos: number
  }
  const byContentId = new Map<string, Row>()
  const unmatched: Array<{ de_donde_vino: string | null; estado: string | null }> = []

  for (const a of agendas || []) {
    const leadId = a.lead_id as string | null
    const cid = (leadId && contentIdByLeadId[leadId])
      || keywordTriggerToContentId[normalizeCta(a.de_donde_vino as string | null) ?? '']

    if (!cid) {
      unmatched.push({ de_donde_vino: a.de_donde_vino as string | null, estado: a.estado as string | null })
      continue
    }

    const piece = pieceById.get(cid)
    const cta = piece?.keyword_trigger || cid
    let row = byContentId.get(cid)
    if (!row) {
      row = { cta, content_id: cid, total: 0, cerrado: 0, no_cerrado: 0, no_show: 0, otros: 0, ingresos: 0 }
      byContentId.set(cid, row)
    }
    row.total++
    if (a.estado === 'Cerrado') {
      row.cerrado++
      row.ingresos += Number(a.monto_facturacion) || Number(a.monto_upfront) || 0
    } else if (a.estado === 'No Cerrado') row.no_cerrado++
    else if (a.estado === 'No Show') row.no_show++
    else row.otros++
  }

  const rows = Array.from(byContentId.values())
    .map((r) => ({
      ...r,
      pct_cerrado: r.total > 0 ? Math.round((r.cerrado / r.total) * 1000) / 10 : null,
    }))
    .sort((a, b) => a.cta.localeCompare(b.cta))

  return NextResponse.json({
    client: { id: client.id, name: client.name },
    rows,
    unmatched_agenda_count: unmatched.length,
    unmatched_sample: unmatched.slice(0, 10),
  })
}
