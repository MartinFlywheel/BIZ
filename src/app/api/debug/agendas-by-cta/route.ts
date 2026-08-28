import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// One-off verification tool: reproduces the same per-CTA breakdown Martin
// tracks externally (CTA, Total agendas, Cerrado, No Cerrado, No Show,
// Ingresos) from this app's own agenda_records + content_pieces, so it can
// be diffed against that external reference without DB access. Also
// surfaces the individual agenda_records behind each CTA (?detail=1) so a
// mismatch can be traced to the specific lead/booking causing it — same
// shape as the R_06_08 first-touch-attribution bug found earlier, where a
// lead's frozen first_touch_content_id disagrees with what the booking's
// own de_donde_vino text says.
function normalizeCta(raw: string | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim().replace(/^manychat:/i, '')
  return trimmed || null
}

export async function GET(request: Request) {
  const supabase = createAdminClient()
  const url = new URL(request.url)
  const clientName = url.searchParams.get('client')
  const includeDetail = url.searchParams.get('detail') === '1'
  if (!clientName) return NextResponse.json({ error: 'Missing ?client= (matches clients.name, case-insensitive substring). Add &detail=1 for per-record breakdown.' }, { status: 400 })

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
    .select('id, lead_id, nombre_lead, de_donde_vino, estado, fecha_agendado, monto_facturacion, monto_upfront')
    .eq('client_id', client.id)

  const leadIds = Array.from(new Set((agendas || []).map((a) => a.lead_id).filter((id): id is string => !!id)))
  const { data: leadsForAgendas } = leadIds.length > 0
    ? await supabase.from('leads').select('id, first_touch_content_id, full_name, ig_username').in('id', leadIds)
    : { data: [] }
  const leadById = new Map((leadsForAgendas || []).map((l) => [l.id, l]))

  const keywordTriggerToContentId = Object.fromEntries(
    (pieces || []).filter((p) => p.keyword_trigger).map((p) => [p.keyword_trigger as string, p.id])
  )
  const pieceById = new Map((pieces || []).map((p) => [p.id, p]))

  interface DetailRow {
    agenda_id: string
    nombre_lead: string | null
    de_donde_vino: string | null
    estado: string | null
    fecha_agendado: string | null
    monto: number
    resolved_via: 'lead_first_touch' | 'de_donde_vino'
    lead_full_name: string | null
    lead_ig_username: string | null
    // True when the lead's frozen first_touch_content_id and the booking's
    // own de_donde_vino text point at two different pieces — the exact
    // signature of the R_06_08-style misattribution bug.
    first_touch_disagrees_with_de_donde_vino: boolean
  }

  interface Row {
    cta: string
    content_id: string | null
    total: number
    cerrado: number
    no_cerrado: number
    no_show: number
    otros: number
    ingresos: number
    detail: DetailRow[]
  }
  const byContentId = new Map<string, Row>()
  const unmatched: Array<{ de_donde_vino: string | null; nombre_lead: string | null; estado: string | null }> = []

  for (const a of agendas || []) {
    const leadId = a.lead_id as string | null
    const lead = leadId ? leadById.get(leadId) : undefined
    const deDondeVinoCid = keywordTriggerToContentId[normalizeCta(a.de_donde_vino as string | null) ?? '']
    const leadCid = lead?.first_touch_content_id ?? null

    const cid = leadCid || deDondeVinoCid
    const resolvedVia: DetailRow['resolved_via'] = leadCid ? 'lead_first_touch' : 'de_donde_vino'

    if (!cid) {
      unmatched.push({
        de_donde_vino: a.de_donde_vino as string | null,
        nombre_lead: a.nombre_lead as string | null,
        estado: a.estado as string | null,
      })
      continue
    }

    const piece = pieceById.get(cid)
    const cta = piece?.keyword_trigger || cid
    let row = byContentId.get(cid)
    if (!row) {
      row = { cta, content_id: cid, total: 0, cerrado: 0, no_cerrado: 0, no_show: 0, otros: 0, ingresos: 0, detail: [] }
      byContentId.set(cid, row)
    }
    row.total++
    let monto = 0
    if (a.estado === 'Cerrado') {
      row.cerrado++
      monto = Number(a.monto_facturacion) || Number(a.monto_upfront) || 0
      row.ingresos += monto
    } else if (a.estado === 'No Cerrado') row.no_cerrado++
    else if (a.estado === 'No Show') row.no_show++
    else row.otros++

    row.detail.push({
      agenda_id: a.id as string,
      nombre_lead: a.nombre_lead as string | null,
      de_donde_vino: a.de_donde_vino as string | null,
      estado: a.estado as string | null,
      fecha_agendado: a.fecha_agendado as string | null,
      monto,
      resolved_via: resolvedVia,
      lead_full_name: lead?.full_name ?? null,
      lead_ig_username: lead?.ig_username ?? null,
      first_touch_disagrees_with_de_donde_vino: !!(leadCid && deDondeVinoCid && leadCid !== deDondeVinoCid),
    })
  }

  const rows = Array.from(byContentId.values())
    .map((r) => ({
      cta: r.cta,
      content_id: r.content_id,
      total: r.total,
      cerrado: r.cerrado,
      no_cerrado: r.no_cerrado,
      no_show: r.no_show,
      otros: r.otros,
      ingresos: r.ingresos,
      pct_cerrado: r.total > 0 ? Math.round((r.cerrado / r.total) * 1000) / 10 : null,
      flagged: r.detail.some((d) => d.first_touch_disagrees_with_de_donde_vino),
      ...(includeDetail ? { detail: r.detail } : {}),
    }))
    .sort((a, b) => a.cta.localeCompare(b.cta))

  return NextResponse.json({
    client: { id: client.id, name: client.name },
    rows,
    unmatched_agenda_count: unmatched.length,
    unmatched: includeDetail ? unmatched : unmatched.slice(0, 10),
    ...(includeDetail ? { pieces: (pieces || []).map((p) => ({ id: p.id, keyword_trigger: p.keyword_trigger, caption: p.caption, content_type: p.content_type })) } : {}),
  })
}
