'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { normalizarInstagram } from '@/lib/services/calendly-event'
import { pickBalancedSetter } from '@/lib/manychat'

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
  /** Usuario de Instagram ya guardado en la agenda, si lo hay. */
  instagram: string | null
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
    .select('id, client_id, agenda_record_id, vence_at, pospuesta_veces, agenda_records(nombre_lead, hora_agenda, email_lead, lead_id, link_perfil)')
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
      | {
          nombre_lead?: string | null
          hora_agenda?: string | null
          email_lead?: string | null
          lead_id?: string | null
          link_perfil?: string | null
        }
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
      instagram: normalizarInstagram(agenda?.link_perfil),
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

/**
 * Resultado de intentar resolver el triaje con un usuario de Instagram.
 *
 * `sin_lead` no es un error: es el caso normal cuando la persona reservo sin
 * haber pasado antes por el CRM, y lo que sigue es ofrecer crear el lead.
 */
export type ResultadoInstagram =
  | { estado: 'asociado'; leadId: string; nombreLead: string | null }
  | { estado: 'sin_lead'; instagram: string }
  | { estado: 'invalido' }

/**
 * Asocia la agenda al lead que tenga ese usuario de Instagram.
 *
 * Es el trabajo que el triaje le exige al setter: sin el usuario de Instagram
 * la agenda no se puede atribuir a nadie, y toda la medicion de que contenido
 * trajo esa llamada se pierde. Por eso el popup no deja cerrar sin esto.
 *
 * El usuario se normaliza antes de comparar: la gente escribe "@juan", "juan" o
 * la URL completa, y las tres tienen que encontrar al mismo lead.
 */
export async function asociarPorInstagram(
  taskId: string,
  agendaId: string,
  clientId: string,
  usuario: string
): Promise<ResultadoInstagram> {
  const ig = normalizarInstagram(usuario)
  if (!ig) return { estado: 'invalido' }

  const supabase = await createClient()

  const { data: lead, error } = await supabase
    .from('leads')
    .select('id, full_name')
    .eq('client_id', clientId)
    .ilike('ig_username', ig)
    .limit(1)
    .maybeSingle()

  if (error && !faltaMigracion(error)) throw error
  if (!lead) return { estado: 'sin_lead', instagram: ig }

  await asociarYCerrar(taskId, agendaId, lead.id, ig)
  return { estado: 'asociado', leadId: lead.id, nombreLead: lead.full_name }
}

/**
 * Crea el lead con ese Instagram y lo asocia a la agenda.
 *
 * Se usa cuando la persona reservo sin haber pasado nunca por el CRM. El nombre
 * y el correo salen de lo que escribio en Calendly, asi que el lead nace con
 * datos reales en vez de solo un usuario suelto.
 *
 * El setter asignado sale del mismo reparto balanceado que usan los webhooks de
 * ManyChat: un lead sin duenio se queda sin seguimiento, y crear leads por una
 * via que se salte esa asignacion es como se producen esos huecos.
 */
export async function crearLeadYAsociar(
  taskId: string,
  agendaId: string,
  clientId: string,
  usuario: string,
  nombre: string | null,
  email: string | null
): Promise<{ leadId: string }> {
  const ig = normalizarInstagram(usuario)
  if (!ig) throw new Error('El usuario de Instagram no es válido')

  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: lead, error } = await supabase
    .from('leads')
    .insert({
      client_id: clientId,
      ig_username: ig,
      full_name: nombre,
      email,
      stage: 'agendado',
      agenda_at: new Date().toISOString(),
      assigned_to: await pickBalancedSetter(admin, clientId),
    })
    .select('id')
    .single()

  if (error) throw error

  await asociarYCerrar(taskId, agendaId, lead.id, ig)
  revalidatePath('/leads')
  return { leadId: lead.id }
}

/**
 * Deja la agenda apuntando al lead y cierra el triaje.
 *
 * El perfil se guarda tambien en la agenda y no solo en el lead: la planilla de
 * agendas se lee sola, sin abrir cada lead, y ahi es donde el setter mira.
 */
async function asociarYCerrar(
  taskId: string,
  agendaId: string,
  leadId: string,
  ig: string
): Promise<void> {
  const supabase = await createClient()
  const { data: sesion } = await supabase.auth.getUser()

  const { error } = await supabase
    .from('agenda_records')
    .update({ lead_id: leadId, link_perfil: `https://instagram.com/${ig}` })
    .eq('id', agendaId)

  if (error) throw error

  const { error: errorTarea } = await supabase
    .from('system_tasks')
    .update({
      estado: 'hecha',
      completada_at: new Date().toISOString(),
      completada_por: sesion.user?.id ?? null,
    })
    .eq('id', taskId)

  if (errorTarea && !faltaMigracion(errorTarea)) throw errorTarea

  revalidatePath('/clients')
}
