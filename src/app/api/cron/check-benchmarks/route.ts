import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logCronRun } from '@/lib/cron-log'
import { fetchAllRows } from '@/lib/supabase/paginate'
import {
  ESTADOS_ASISTIO,
  ESTADOS_CON_DESENLACE,
  ESTADO_CERRADO,
} from '@/lib/metrics-types'

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
    await logCronRun('check-benchmarks', { clientes: 0, motivo: 'sin clientes activos' })
    return NextResponse.json({ status: 'no_active_clients' })
  }

  const notifications = []

  for (const client of clients) {
    const { count: totalChats } = await supabaseAdmin
      .from('interactions')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)

    // 'conversacion_real' O 'lead_calificado': la clasificacion se promueve en
    // el mismo registro a medida que el lead avanza, asi que un lead que llego
    // a calificado ya no lleva el valor 'conversacion_real' aunque obviamente
    // tuvo una conversacion real. Misma definicion que getDashboardMetrics.
    const { count: realConvos } = await supabaseAdmin
      .from('interactions')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .in('classification', ['conversacion_real', 'lead_calificado'])

    // Las agendas salen de agenda_records.estado, la misma fuente que usan
    // getDashboardMetrics y calculateFunnel.
    //
    // Antes esto filtraba leads.stage contra 'agenda_set'/'showed_up'/
    // 'closed_won'/'closed_lost', valores de la taxonomia inglesa que ya no
    // existe (LEAD_STAGES hoy es 'agendado'/'cierre'/etc, en espanol).
    // Ninguna ruta del codigo escribe ya 'showed_up' ni 'closed_won' — el
    // webhook de Calendly pone 'agenda_set' y el resto usa los valores en
    // espanol — asi que showUps y cierres daban 0 salvo por filas historicas.
    // Con eso, este cron marcaba tasa_show_up y tasa_cierre como criticas para
    // todos los clientes, todos los dias, y notificaba a los responsables de
    // cada area por un deficit que nunca existio.
    const agendaRecords = await fetchAllRows<{ estado: string | null }>((from, to) =>
      supabaseAdmin
        .from('agenda_records')
        .select('estado')
        .eq('client_id', client.id)
        .range(from, to)
    )

    const llamadas = agendaRecords.filter(
      (a) => a.estado && (ESTADOS_CON_DESENLACE as readonly string[]).includes(a.estado)
    ).length
    const showUps = agendaRecords.filter(
      (a) => a.estado && (ESTADOS_ASISTIO as readonly string[]).includes(a.estado)
    ).length
    const cierres = agendaRecords.filter((a) => a.estado === ESTADO_CERRADO).length

    // null = esa etapa no tiene denominador todavia, no es un 0% real. Un
    // cliente recien creado, o uno sin llamadas en el periodo, no tiene un
    // deficit de show-up: no tiene datos. Antes ese 0 se comparaba igual
    // contra el benchmark y disparaba una alerta critica.
    const metrics: Record<string, number | null> = {
      tasa_respuesta: (totalChats || 0) > 0 ? ((realConvos || 0) / (totalChats || 1)) * 100 : null,
      tasa_show_up: llamadas > 0 ? (showUps / llamadas) * 100 : null,
      tasa_cierre: showUps > 0 ? (cierres / showUps) * 100 : null,
    }

    // Ordenado igual que getBenchmarkAlerts: los benchmarks propios del
    // cliente primero y los globales (client_id null) al final, para que el
    // dedup por metric_key de abajo se quede con el especifico. Sin el
    // .order(), cual de los dos ganaba dependia del orden en que Postgres
    // devolviera las filas, asi que un benchmark configurado a medida para un
    // cliente se ignoraba a veces sin aviso.
    const { data: benchmarks } = await supabaseAdmin
      .from('benchmarks')
      .select('*')
      .or(`client_id.eq.${client.id},client_id.is.null`)
      .order('client_id', { ascending: false, nullsFirst: false })

    if (!benchmarks) continue

    const seen = new Set<string>()
    for (const b of benchmarks) {
      if (seen.has(b.metric_key)) continue
      seen.add(b.metric_key)

      const current = metrics[b.metric_key]
      if (current === undefined || current === null) continue

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

  await logCronRun('check-benchmarks', {
    clientes: clients.length,
    notificaciones: notifications.length,
  })

  return NextResponse.json({
    status: 'completed',
    notifications_sent: notifications.length,
  })
}
