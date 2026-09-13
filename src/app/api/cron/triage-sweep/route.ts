import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logCronRun } from '@/lib/cron-log'
import {
  COLUMNA_INEXISTENTE,
  TABLA_INEXISTENTE,
  POSTERGACIONES_PARA_ESCALAR,
  direccionDeVentas,
  escalarTriaje,
  usuarioPorNombre,
  vencimientoTriaje,
} from '@/lib/services/pipeline-agendas'
import { completarBorradorDeAgenda } from '@/lib/services/reporte-llamada'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// Mantiene las tres colas del Pipeline de Agendas.
//
//   triaje_agenda    Dirección de ventas. Una por agenda nueva del calendario.
//                    Vence a las 24 h de agendada o 2 h antes de la llamada.
//   asociar_lead     Setter. Solo cuando el cruce automático no encontró lead.
//   reporte_llamada  Dirección de ventas. Cuando llega la grabación de Fathom;
//                    el borrador ya viene escrito.
//
// Además cierra solas las tareas que ya no tienen sentido (la agenda se
// canceló, alguien asoció el lead desde la planilla), redacta los borradores
// pendientes y escala los triajes vencidos o pospuestos tres veces.
//
// Corre cada 15 minutos desde pg_cron (ver 053). El índice único sobre
// (agenda_record_id, tipo) hace que repetir la pasada no duplique nada.

const DIAS = 3

interface Agenda {
  id: string
  client_id: string
  created_at: string
  hora_agenda: string | null
  lead_id: string | null
  setter: string | null
  cancelada_at?: string | null
  triaje?: unknown
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const desde = new Date(Date.now() - DIAS * 86_400_000).toISOString()
  const resumen = {
    triajesCreados: 0,
    asociacionesCreadas: 0,
    reportesCreados: 0,
    borradores: 0,
    cerradas: 0,
    escaladas: 0,
    revisadas: 0,
    motivo: null as string | null,
  }

  // Sin la 070 no existen asignado_a, triaje ni reporte_estado. El barrido
  // sigue creando triajes como antes y deja el resto para cuando se corra.
  const sonda = await supabase.from('system_tasks').select('asignado_a, escalada_at').limit(1)
  if (sonda.error?.code === TABLA_INEXISTENTE) {
    resumen.motivo = 'Falta correr 053-triaje-agendas.sql'
    await logCronRun('triage-sweep', resumen)
    return NextResponse.json({ ok: false, ...resumen })
  }
  const con070 = sonda.error?.code !== COLUMNA_INEXISTENTE
  if (!con070) resumen.motivo = 'Falta correr 070-pipeline-agendas-ficha-y-reporte.sql'

  const { data: agendasBrutas, error } = con070
    ? await supabase
        .from('agenda_records')
        .select('id, client_id, created_at, hora_agenda, lead_id, setter, cancelada_at, triaje')
        .not('google_event_id', 'is', null)
        .gte('created_at', desde)
    : await supabase
        .from('agenda_records')
        .select('id, client_id, created_at, hora_agenda, lead_id, setter')
        .not('google_event_id', 'is', null)
        .gte('created_at', desde)

  if (error) {
    resumen.motivo = error.message
    await logCronRun('triage-sweep', resumen)
    return NextResponse.json({ ok: false, ...resumen })
  }

  const agendas = (agendasBrutas ?? []) as Agenda[]
  const vivas = agendas.filter((a) => !a.cancelada_at)
  resumen.revisadas = agendas.length

  // La dirección de ventas de cada cliente, una consulta por cliente.
  const direccion = new Map<string, string | null>()
  for (const clientId of new Set(vivas.map((a) => a.client_id))) {
    direccion.set(clientId, con070 ? await direccionDeVentas(supabase, clientId) : null)
  }

  // ── 1. Triajes ──────────────────────────────────────────────────────────
  const triajes = vivas.map((a) => ({
    client_id: a.client_id,
    agenda_record_id: a.id,
    tipo: 'triaje_agenda',
    vence_at: vencimientoTriaje(a.created_at, a.hora_agenda),
    ...(con070 ? { asignado_a: direccion.get(a.client_id) ?? null } : {}),
  }))
  if (triajes.length > 0) {
    const { data, error: e } = await supabase
      .from('system_tasks')
      .upsert(triajes, { onConflict: 'agenda_record_id,tipo', ignoreDuplicates: true })
      .select('id')
    if (e) resumen.motivo = e.message
    resumen.triajesCreados = data?.length ?? 0
  }

  if (con070) {
    // ── 2. Asociar lead: solo las que el cruce automático no resolvió ─────
    const sinLead = vivas.filter((a) => !a.lead_id)
    const asociaciones = []
    for (const a of sinLead) {
      asociaciones.push({
        client_id: a.client_id,
        agenda_record_id: a.id,
        tipo: 'asociar_lead',
        vence_at: vencimientoTriaje(a.created_at, a.hora_agenda),
        asignado_a: await usuarioPorNombre(supabase, a.client_id, a.setter),
      })
    }
    if (asociaciones.length > 0) {
      const { data } = await supabase
        .from('system_tasks')
        .upsert(asociaciones, { onConflict: 'agenda_record_id,tipo', ignoreDuplicates: true })
        .select('id')
      resumen.asociacionesCreadas = data?.length ?? 0
    }

    // ── 3. Cerrar lo que ya no tiene sentido ──────────────────────────────
    const ahora = new Date().toISOString()
    const cerrar = async (ids: string[], tipo: string, estado: 'hecha' | 'descartada') => {
      if (ids.length === 0) return
      const { data } = await supabase
        .from('system_tasks')
        .update({ estado, completada_at: ahora })
        .in('agenda_record_id', ids)
        .eq('tipo', tipo)
        .eq('estado', 'pendiente')
        .select('id')
      resumen.cerradas += data?.length ?? 0
    }
    await cerrar(agendas.filter((a) => a.lead_id).map((a) => a.id), 'asociar_lead', 'hecha')
    await cerrar(agendas.filter((a) => a.triaje).map((a) => a.id), 'triaje_agenda', 'hecha')
    const canceladas = agendas.filter((a) => a.cancelada_at).map((a) => a.id)
    for (const tipo of ['triaje_agenda', 'asociar_lead', 'reporte_llamada']) {
      await cerrar(canceladas, tipo, 'descartada')
    }

    // ── 4. Reportes: borrador y tarea de aprobación ───────────────────────
    // Sin ventana de días: una grabación puede llegar una semana después de
    // agendada, y el reporte igual hay que aprobarlo.
    const { data: conGrabacion } = await supabase
      .from('agenda_records')
      .select('id, client_id, hora_agenda, reporte_estado, objecion, situacion_actual, dolores, preguntas_no_resueltas')
      .not('fathom_resumen', 'is', null)
      .or('reporte_estado.is.null,reporte_estado.eq.borrador')
      .limit(30)

    for (const a of conGrabacion ?? []) {
      const vacio = !a.objecion && !a.situacion_actual && !a.dolores && !a.preguntas_no_resueltas
      if (a.reporte_estado === null || vacio) {
        if (await completarBorradorDeAgenda(supabase, a.id as string)) resumen.borradores++
      }
    }

    const reportes = []
    for (const a of conGrabacion ?? []) {
      const clientId = a.client_id as string
      if (!direccion.has(clientId)) direccion.set(clientId, await direccionDeVentas(supabase, clientId))
      reportes.push({
        client_id: clientId,
        agenda_record_id: a.id as string,
        tipo: 'reporte_llamada',
        // Un reporte se aprueba mientras la llamada está fresca: 24 h desde que
        // terminó, o desde ahora si la hora no se conoce.
        vence_at: new Date(
          (a.hora_agenda ? new Date(a.hora_agenda as string).getTime() : Date.now()) + 24 * 3_600_000
        ).toISOString(),
        asignado_a: direccion.get(clientId) ?? null,
      })
    }
    if (reportes.length > 0) {
      const { data } = await supabase
        .from('system_tasks')
        .upsert(reportes, { onConflict: 'agenda_record_id,tipo', ignoreDuplicates: true })
        .select('id')
      resumen.reportesCreados = data?.length ?? 0
    }

    // ── 5. Escalar ────────────────────────────────────────────────────────
    const { data: porEscalar } = await supabase
      .from('system_tasks')
      .select('id, client_id, agenda_record_id, pospuesta_veces, vence_at')
      .eq('tipo', 'triaje_agenda')
      .eq('estado', 'pendiente')
      .is('escalada_at', null)
      .or(`pospuesta_veces.gte.${POSTERGACIONES_PARA_ESCALAR},vence_at.lt."${ahora}"`)
      .limit(20)

    for (const t of porEscalar ?? []) {
      const vencida = !!t.vence_at && (t.vence_at as string) < ahora
      await escalarTriaje(
        supabase,
        {
          id: t.id as string,
          client_id: t.client_id as string,
          agenda_record_id: (t.agenda_record_id as string | null) ?? null,
          pospuesta_veces: (t.pospuesta_veces as number) ?? 0,
        },
        vencida ? 'vencida' : 'postergada'
      )
      resumen.escaladas++
    }
  }

  await logCronRun('triage-sweep', resumen)
  return NextResponse.json({ ok: true, ...resumen })
}
