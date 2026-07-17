import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paginate'

// Cron endpoint — must run at request time, never cached.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const supabaseAdmin = createAdminClient()
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: clients } = await supabaseAdmin
    .from('clients')
    .select('id, name, ig_handle')
    .eq('status', 'active')

  if (!clients || clients.length === 0) {
    return NextResponse.json({ status: 'no_active_clients' })
  }

  const notifications = []

  for (const client of clients) {
    const { count: totalChats } = await supabaseAdmin
      .from('interactions')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)

    const { count: realConvos } = await supabaseAdmin
      .from('interactions')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .eq('classification', 'conversacion_real')

    const leads = await fetchAllRows((from, to) =>
      supabaseAdmin.from('leads').select('stage').eq('client_id', client.id).range(from, to)
    )

    const agendas = leads.filter((l) =>
      ['agenda_set', 'showed_up', 'closed_won', 'closed_lost'].includes(l.stage)
    ).length
    const showUps = leads.filter((l) =>
      ['showed_up', 'closed_won'].includes(l.stage)
    ).length
    const cierres = leads.filter((l) => l.stage === 'closed_won').length

    const metrics: Record<string, number> = {
      tasa_respuesta: (totalChats || 0) > 0 ? ((realConvos || 0) / (totalChats || 1)) * 100 : 0,
      tasa_show_up: agendas > 0 ? (showUps / agendas) * 100 : 0,
      tasa_cierre: showUps > 0 ? (cierres / showUps) * 100 : 0,
    }

    const { data: benchmarks } = await supabaseAdmin
      .from('benchmarks')
      .select('*')
      .or(`client_id.eq.${client.id},client_id.is.null`)

    if (!benchmarks) continue

    const seen = new Set<string>()
    for (const b of benchmarks) {
      if (seen.has(b.metric_key)) continue
      seen.add(b.metric_key)

      const current = metrics[b.metric_key]
      if (current === undefined) continue

      const isFailing = b.comparison === 'gte' ? current < b.threshold_value : current > b.threshold_value

      if (isFailing && b.responsible_area) {
        const { data: assignments } = await supabaseAdmin
          .from('team_assignments')
          .select('user_id')
          .eq('client_id', client.id)
          .eq('responsibility', b.responsible_area)

        for (const assignment of assignments || []) {
          notifications.push({
            user_id: assignment.user_id,
            title: `Alerta: ${b.metric_key.replace(/_/g, ' ')} - ${client.name}`,
            body: b.diagnosis_message || `${b.metric_key} está en ${current.toFixed(1)}% (benchmark: ${b.threshold_value}%)`,
            type: 'diagnosis',
            severity: 'critical',
            reference_type: 'client',
            reference_id: client.id,
          })
        }
      }
    }
  }

  if (notifications.length > 0) {
    await supabaseAdmin.from('notifications').insert(notifications)
  }

  return NextResponse.json({
    status: 'completed',
    notifications_sent: notifications.length,
  })
}
