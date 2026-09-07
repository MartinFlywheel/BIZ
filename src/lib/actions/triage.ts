'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

/**
 * El triaje de las agendas nuevas.
 *
 * Una agenda entra sola desde Calendly y nadie se entera. Estas tareas son el
 * aviso: aparecen en un popup hasta que alguien decide algo, y se pueden
 * posponer, pero posponer deja rastro.
 *
 * Depende de la migración 053. Si no se corrió, todo esto devuelve vacío en vez
 * de reventar: el popup simplemente no aparece.
 */

const TABLA_INEXISTENTE = '42P01'
const COLUMNA_INEXISTENTE = '42703'

function faltaMigracion(error: { code?: string } | null | undefined): boolean {
  return error?.code === TABLA_INEXISTENTE || error?.code === COLUMNA_INEXISTENTE
}

export interface TareaTriaje {
  id: string
  clientId: string
  agendaRecordId: string | null
  venceAt: string | null
  pospuestaVeces: number
  /** Datos de la agenda, para que el popup diga de qué se trata. */
  nombreLead: string | null
  horaAgenda: string | null
  emailLead: string | null
  /** Si la agenda ya tiene lead asociado. Es lo que hay que revisar. */
  tieneLead: boolean
}

/**
 * Las tareas de triaje pendientes y ya visibles de un cliente.
 *
 * Se piden las agendas en el mismo viaje: el popup necesita mostrar de qué
 * agenda habla, y sin el join haría una consulta por tarea.
 */
export async function getTareasDeTriaje(clientId: string): Promise<TareaTriaje[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('system_tasks')
    .select('id, client_id, agenda_record_id, vence_at, pospuesta_veces, agenda_records(nombre_lead, hora_agenda, email_lead, lead_id)')
    .eq('client_id', clientId)
    .eq('tipo', 'triaje_agenda')
    .eq('estado', 'pendiente')
    .lte('visible_desde', new Date().toISOString())
    .order('vence_at', { ascending: true })
    .limit(20)

  // Sin la 053 no hay tabla. El popup no aparece y el CRM sigue igual.
  if (error) {
    if (!faltaMigracion(error)) {
      console.error(`[triaje] no se pudieron leer las tareas: ${error.message}`)
    }
    return []
  }

  return (data ?? []).map((t) => {
    // El join viene como objeto o como arreglo de uno según la relación.
    const bruto = (t as { agenda_records?: unknown }).agenda_records
    const agenda = (Array.isArray(bruto) ? bruto[0] : bruto) as
      | { nombre_lead?: string | null; hora_agenda?: string | null; email_lead?: string | null; lead_id?: string | null }
      | undefined

    return {
      id: t.id as string,
      clientId: t.client_id as string,
      agendaRecordId: (t.agenda_record_id as string | null) ?? null,
      venceAt: (t.vence_at as string | null) ?? null,
      pospuestaVeces: (t.pospuesta_veces as number) ?? 0,
      nombreLead: agenda?.nombre_lead ?? null,
      horaAgenda: agenda?.hora_agenda ?? null,
      emailLead: agenda?.email_lead ?? null,
      tieneLead: !!agenda?.lead_id,
    }
  })
}

/** Marca el triaje como hecho. */
export async function completarTriaje(taskId: string): Promise<void> {
  const supabase = await createClient()
  const { data: sesion } = await supabase.auth.getUser()

  const { error } = await supabase
    .from('system_tasks')
    .update({
      estado: 'hecha',
      completada_at: new Date().toISOString(),
      completada_por: sesion.user?.id ?? null,
    })
    .eq('id', taskId)

  if (error && !faltaMigracion(error)) throw error
  revalidatePath('/clients')
}

/**
 * Posterga el triaje.
 *
 * No se toca `vence_at`: el límite de las 24 horas sigue siendo el original,
 * porque si posponer también corriera el vencimiento se podría postergar para
 * siempre sin quedar nunca atrasado, que es exactamente lo que este mecanismo
 * intenta evitar.
 */
export async function posponerTriaje(taskId: string, horas = 2): Promise<void> {
  const supabase = await createClient()

  const { data: actual, error: errorLectura } = await supabase
    .from('system_tasks')
    .select('pospuesta_veces')
    .eq('id', taskId)
    .maybeSingle()

  if (errorLectura && !faltaMigracion(errorLectura)) throw errorLectura

  const { error } = await supabase
    .from('system_tasks')
    .update({
      visible_desde: new Date(Date.now() + horas * 3_600_000).toISOString(),
      pospuesta_veces: ((actual?.pospuesta_veces as number) ?? 0) + 1,
    })
    .eq('id', taskId)

  if (error && !faltaMigracion(error)) throw error
  revalidatePath('/clients')
}
