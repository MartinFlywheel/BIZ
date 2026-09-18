import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logCronRun } from '@/lib/cron-log'
import { getEffectiveMetricsForRange } from '@/lib/actions/live-metrics'
import { evaluarEmbudo, METAS_EMBUDO } from '@/lib/embudo'
import { hoyChile, sumarDias } from '@/lib/fecha-chile'

// Cron endpoint — must run at request time, never cached.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Aviso diario de metas: a cada responsable, las etapas del embudo de su
 * cliente que quedaron bajo la meta.
 *
 * Mide lo mismo que el embudo del Dashboard con el período "15 días": el
 * mismo cálculo (getEffectiveMetricsForRange, con las correcciones del
 * Diario) y las mismas metas (src/lib/embudo.ts). Si llega un aviso, abrir el
 * Dashboard en "15 días" muestra esa etapa en rojo.
 *
 * Antes contaba sobre toda la historia del cliente, con sus propias consultas
 * y con las metas de la tabla `benchmarks` (60% show-up, 20% cierre), que no
 * eran las del embudo (70% y 30%). Se eligieron 15 días y no la semana en
 * curso porque este cron corre temprano: un lunes, la semana tendría solo
 * unas horas de datos.
 */
const DIAS = 15

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

  const hasta = hoyChile().iso
  const desde = sumarDias(hasta, -(DIAS - 1))
  const notifications = []
  const sinResponsable: string[] = []

  for (const client of clients) {
    const m = await getEffectiveMetricsForRange(client.id, desde, hasta, undefined, supabaseAdmin)
    const vistas = m.views_reels + m.views_carruseles + m.views_historias
    // Sin actividad no hay nada que diagnosticar (el embudo muestra "sin datos").
    if (vistas + m.chats_abiertos + m.agendas === 0) continue

    const { stages } = evaluarEmbudo({
      vistas,
      chats: m.chats_abiertos,
      conversaciones: m.conversaciones,
      agendas: m.agendas,
      llamadas: m.llamadas,
      shows: m.shows,
      cierres: m.cierres,
    })

    for (const stage of stages) {
      if (stage.status !== 'critical') continue
      const meta = METAS_EMBUDO.find((x) => x.id === stage.id)
      if (!meta) continue

      const { data: assignments } = await supabaseAdmin
        .from('team_assignments')
        .select('user_id')
        .eq('client_id', client.id)
        .eq('responsibility', meta.area)

      if (!assignments || assignments.length === 0) {
        sinResponsable.push(`${client.name}: ${meta.label} (${meta.area})`)
        continue
      }

      for (const assignment of assignments) {
        notifications.push({
          user_id: assignment.user_id,
          title: `Tasa de ${meta.label.toLowerCase()} bajo la meta — ${client.name}`,
          body: `${meta.diagnostico} Últimos ${DIAS} días: ${stage.rate.toFixed(1)}% (meta ${meta.min}–${meta.max}%).`,
          type: 'diagnosis',
          severity: 'critical',
          reference_type: 'client',
          reference_id: client.id,
        })
      }
    }
  }

  if (notifications.length > 0) {
    await supabaseAdmin.from('notifications').insert(notifications)
  }

  // Las etapas en rojo sin nadie asignado a su área quedan en el log: si no,
  // el aviso fallaba en silencio (pasó meses sin avisarle a nadie porque no
  // había asignaciones de contenido, setting ni closing).
  await logCronRun('check-benchmarks', {
    clientes: clients.length,
    notificaciones: notifications.length,
    sin_responsable: sinResponsable,
  })

  return NextResponse.json({
    status: 'completed',
    notifications_sent: notifications.length,
    sin_responsable: sinResponsable,
  })
}
