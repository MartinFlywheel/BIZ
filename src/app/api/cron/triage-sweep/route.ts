import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logCronRun } from '@/lib/cron-log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Crea una tarea de triaje por cada agenda nueva que llego desde Calendly.
//
// El plan pedia que el director revisara cada agenda dentro de las 24 horas.
// Sin esto una agenda entra sola y se queda muda hasta que alguien abre la
// planilla por casualidad, que es justo el problema que habia antes.
//
// Corre cada 15 minutos desde pg_cron (ver 053-triaje-agendas.sql). El indice
// unico sobre (agenda_record_id, tipo) es lo que hace que repetir la pasada no
// duplique tareas, asi que la ruta puede ser tonta y reinsertar siempre.

const TABLA_INEXISTENTE = '42P01'

// Cuanto hacia atras mirar. Las agendas mas viejas que esto ya pasaron su
// ventana de 24 horas y crear el aviso ahora solo generaria ruido.
const DIAS = 3

// El plazo del plan.
const HORAS_PARA_TRIAR = 24

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const desde = new Date(Date.now() - DIAS * 86_400_000).toISOString()

  // Solo las agendas que trajo el sync: las cargadas a mano ya las vio alguien
  // al escribirlas, y avisar sobre ellas seria ruido puro.
  const { data: agendas, error } = await supabase
    .from('agenda_records')
    .select('id, client_id, created_at')
    .not('google_event_id', 'is', null)
    .gte('created_at', desde)

  if (error) {
    const motivo = error.code === TABLA_INEXISTENTE
      ? 'Falta correr 053-triaje-agendas.sql'
      : error.message
    await logCronRun('triage-sweep', { creadas: 0, motivo })
    return NextResponse.json({ ok: false, motivo })
  }

  if (!agendas || agendas.length === 0) {
    await logCronRun('triage-sweep', { creadas: 0, revisadas: 0 })
    return NextResponse.json({ ok: true, creadas: 0, revisadas: 0 })
  }

  const filas = agendas.map((a) => ({
    client_id: a.client_id,
    agenda_record_id: a.id,
    tipo: 'triaje_agenda',
    // El limite corre desde que la agenda entro al CRM, no desde ahora: si el
    // cron estuvo caido un dia, la tarea nace ya vencida, que es la verdad.
    vence_at: new Date(
      new Date(a.created_at).getTime() + HORAS_PARA_TRIAR * 3_600_000
    ).toISOString(),
  }))

  // ignoreDuplicates deja que el indice unico haga el trabajo: las agendas que
  // ya tienen triaje se saltan solas y no hay que consultarlas antes.
  const { data: creadas, error: errorInsert } = await supabase
    .from('system_tasks')
    .upsert(filas, { onConflict: 'agenda_record_id,tipo', ignoreDuplicates: true })
    .select('id')

  if (errorInsert) {
    const motivo = errorInsert.code === TABLA_INEXISTENTE
      ? 'Falta correr 053-triaje-agendas.sql'
      : errorInsert.message
    await logCronRun('triage-sweep', { creadas: 0, motivo })
    return NextResponse.json({ ok: false, motivo })
  }

  const total = creadas?.length ?? 0
  await logCronRun('triage-sweep', { creadas: total, revisadas: agendas.length })
  return NextResponse.json({ ok: true, creadas: total, revisadas: agendas.length })
}
