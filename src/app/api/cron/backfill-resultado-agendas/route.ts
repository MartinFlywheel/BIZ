import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exigirCronSecret } from '@/lib/api-auth'
import { logCronRun } from '@/lib/cron-log'
import { fetchAllRows } from '@/lib/supabase/paginate'
import {
  calcularCambio,
  type AgendaResultado,
  type CambioLead,
  type LeadResultado,
} from '@/lib/services/resultado-agenda'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// Lleva al lead el resultado de las agendas que ya existían antes de que
// updateAgendaRecord y aprobarReporte lo hicieran solos: de las 17 agendas
// "Cerrado" de Mane, 15 leads seguían en "agendado" y ninguno tenía closed_at.
// Uso puntual:
//
//   select private.call_cron_endpoint('/api/cron/backfill-resultado-agendas?dry=1');
//   select private.call_cron_endpoint('/api/cron/backfill-resultado-agendas');
//
// Recorre las agendas con lead y estado, de la llamada más antigua a la más
// nueva, y aplica las mismas reglas que resultado-agenda.ts (Cerrado → cierre
// con monto, No Calificado → no_calificado, el resto al menos agendado, nunca
// hacia atrás). No hay "estado anterior" que corregir: solo avanza.
//
// Idempotente: un lead que ya está en la etapa correcta no genera cambio, y
// cada escritura exige que la etapa siga siendo la leída.

const MAX_CAMBIOS_POR_CORRIDA = 200

export async function GET(request: Request) {
  const noAutorizado = exigirCronSecret(request)
  if (noAutorizado) return noAutorizado

  const dry = new URL(request.url).searchParams.get('dry') === '1'
  const supabase = createAdminClient()

  let agendas: (AgendaResultado & { cancelada_at: string | null })[]
  try {
    agendas = await fetchAllRows<AgendaResultado & { cancelada_at: string | null }>((from, to) =>
      supabase
        .from('agenda_records')
        .select('id, client_id, lead_id, estado, monto_facturacion, monto_upfront, hora_agenda, fecha_agenda, cancelada_at')
        .not('lead_id', 'is', null)
        .not('estado', 'is', null)
        .order('fecha_agenda', { ascending: true, nullsFirst: true })
        .order('id', { ascending: true })
        .range(from, to)
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? 'error'
    await logCronRun('backfill-resultado-agendas', { fallo: 'no se pudo leer agenda_records', error: msg, dry })
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const vigentes = agendas
    .filter((a) => !a.cancelada_at)
    .sort((a, b) => (a.hora_agenda ?? a.fecha_agenda ?? '').localeCompare(b.hora_agenda ?? b.fecha_agenda ?? ''))

  const leadIds = [...new Set(vigentes.map((a) => a.lead_id as string))]
  const clientIds = [...new Set(vigentes.map((a) => a.client_id))]

  const leads = new Map<string, LeadResultado>()
  for (let i = 0; i < leadIds.length; i += 150) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, stage, closed_at, close_value')
      .in('id', leadIds.slice(i, i + 150))
    if (error) {
      await logCronRun('backfill-resultado-agendas', { fallo: 'no se pudo leer leads', error: error.message, dry })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    for (const l of data ?? []) leads.set(l.id as string, l as LeadResultado)
  }

  const etapasPorCliente = new Map<string, string[] | null>()
  if (clientIds.length > 0) {
    const { data } = await supabase.from('clients').select('id, pipeline_stages').in('id', clientIds)
    for (const c of data ?? []) {
      etapasPorCliente.set(c.id as string, ((c.pipeline_stages ?? null) as { id: string }[] | null)?.map((e) => e.id) ?? null)
    }
  }

  const estadosPorLead = new Map<string, { id: string; estado: string }[]>()
  for (const a of vigentes) {
    const lista = estadosPorLead.get(a.lead_id as string) ?? []
    lista.push({ id: a.id, estado: a.estado ?? '' })
    estadosPorLead.set(a.lead_id as string, lista)
  }

  const cambios: (CambioLead & { aplicado?: boolean; error?: string })[] = []
  let sinLead = 0
  for (const a of vigentes) {
    if (cambios.length >= MAX_CAMBIOS_POR_CORRIDA) break
    const lead = leads.get(a.lead_id as string)
    if (!lead) { sinLead++; continue }
    const otras = (estadosPorLead.get(lead.id) ?? []).filter((o) => o.id !== a.id).map((o) => o.estado)
    const cambio = calcularCambio(a, lead, etapasPorCliente.get(a.client_id) ?? null, otras)
    if (!cambio) continue

    const fila: CambioLead & { aplicado?: boolean; error?: string } = { ...cambio }
    if (!dry) {
      const { data, error } = await supabase
        .from('leads')
        .update({ ...cambio.campos, updated_at: new Date().toISOString() })
        .eq('id', cambio.leadId)
        .eq('stage', cambio.desde)
        .select('id')
      if (error) fila.error = error.message
      else fila.aplicado = (data ?? []).length > 0
    }
    cambios.push(fila)

    // La siguiente agenda del mismo lead ve el lead ya movido.
    leads.set(lead.id, {
      ...lead,
      stage: (cambio.campos.stage as string | undefined) ?? lead.stage,
      closed_at: 'closed_at' in cambio.campos ? (cambio.campos.closed_at as string | null) : lead.closed_at,
      close_value: 'close_value' in cambio.campos ? (cambio.campos.close_value as number | null) : lead.close_value,
    })
  }

  const porDestino: Record<string, number> = {}
  for (const c of cambios) porDestino[`${c.desde} → ${c.hasta}`] = (porDestino[`${c.desde} → ${c.hasta}`] ?? 0) + 1

  const errores = cambios.filter((c) => c.error).map((c) => ({ lead: c.leadId, error: c.error }))
  const resumen = {
    dry,
    agendasRevisadas: vigentes.length,
    cambios: cambios.length,
    aplicados: dry ? 0 : cambios.filter((c) => c.aplicado).length,
    porDestino,
    leadsNoEncontrados: sinLead,
    tope: MAX_CAMBIOS_POR_CORRIDA,
    ...(errores.length > 0 && { errores: errores.slice(0, 20) }),
  }
  await logCronRun('backfill-resultado-agendas', resumen)

  return NextResponse.json({
    ...resumen,
    detalle: cambios.map((c) => ({
      lead: c.leadId,
      agenda: c.agendaId,
      desde: c.desde,
      hasta: c.hasta,
      motivo: c.motivo,
      closeValue: c.campos.close_value ?? null,
      closedAt: c.campos.closed_at ?? null,
      ...(dry ? {} : { aplicado: c.aplicado ?? false }),
      ...(c.error ? { error: c.error } : {}),
    })),
  })
}
