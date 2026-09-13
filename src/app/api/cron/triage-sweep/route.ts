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

  // Una llamada que ya ocurrió no necesita triaje ni que alguien asocie el lead
  // desde el popup: crear la tarea solo produciría un aviso vencido sin salida.
  const ahoraMs = Date.now()
  const porVenir = vivas.filter((a) => !a.hora_agenda || new Date(a.hora_agenda).getTime() > ahoraMs)

  // ── 1. Triajes ──────────────────────────────────────────────────────────
  const triajes = porVenir.map((a) => ({
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
    const sinLead = porVenir.filter((a) => !a.lead_id)
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

    // Triajes y asociaciones cuya llamada ya pasó, sin ventana de días: si no,
    // un triaje que nadie hizo quedaba pendiente para siempre, vencido y sin
    // opción de posponer, tapando el popup. Quedan como descartadas sin
    // completada_at, así que siguen contando como "no se hizo a tiempo".
    const { data: pasadas } = await supabase
      .from('system_tasks')
      .select('id, agenda_records!inner(hora_agenda)')
      .in('tipo', ['triaje_agenda', 'asociar_lead'])
      .eq('estado', 'pendiente')
      .lt('agenda_records.hora_agenda', ahora)
      .limit(200)
    const idsPasadas = (pasadas ?? []).map((t) => t.id as string)
    if (idsPasadas.length > 0) {
      const { data } = await supabase
        .from('system_tasks')
        .update({ estado: 'descartada' })
        .in('id', idsPasadas)
        .select('id')
      resumen.cerradas += data?.length ?? 0
    }

    // ── 4. Reportes: tarea de aprobación y borrador ───────────────────────
    // Sin ventana de días: una grabación puede llegar una semana después de
    // agendada, y el reporte igual hay que aprobarlo. Las tareas van primero:
    // redactar llama a un modelo y es lo lento, así que si la función se queda
    // sin tiempo, al menos las tareas ya existen.
    const { data: conGrabacion } = await supabase
      .from('agenda_records')
      .select('id, client_id, hora_agenda, reporte_estado')
      .not('fathom_resumen', 'is', null)
      .or('reporte_estado.is.null,reporte_estado.eq.borrador')
      .order('hora_agenda', { ascending: false, nullsFirst: false })
      .limit(50)

    const reportes = []
    for (const a of conGrabacion ?? []) {
      const clientId = a.client_id as string
      if (!direccion.has(clientId)) direccion.set(clientId, await direccionDeVentas(supabase, clientId))
      reportes.push({
        client_id: clientId,
        agenda_record_id: a.id as string,
        tipo: 'reporte_llamada',
        // 24 h para aprobarlo, desde la llamada o desde ahora, lo que sea más
        // tarde: una grabación que llega días después no puede nacer vencida
        // (fue lo que dejó el reporte de Daniela pegado al popup).
        vence_at: new Date(
          Math.max(a.hora_agenda ? new Date(a.hora_agenda as string).getTime() : 0, Date.now()) + 24 * 3_600_000
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

    // Solo lo que nunca se redactó, y de a pocas por vuelta. completarBorrador
    // deja la agenda en "borrador" aunque el resumen no diera nada, así que no
    // se reintenta la misma cada 15 minutos.
    const sinRedactar = (conGrabacion ?? []).filter((a) => a.reporte_estado === null).slice(0, 5)
    for (const a of sinRedactar) {
      if (await completarBorradorDeAgenda(supabase, a.id as string)) resumen.borradores++
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
