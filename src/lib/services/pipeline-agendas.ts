import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Reglas compartidas del Pipeline de Agendas: plazos, responsables y avisos.
 *
 * Viven aquí y no en cada acción porque las usan tres lugares distintos —el
 * barrido del cron, el popup y la planilla— y si cada uno calculara el plazo a
 * su manera, el popup diría "vence en 3 h" mientras la planilla dice "vencido".
 *
 * Todo lo que escribe va con el cliente admin: las notificaciones son para
 * otras personas y la política de `notifications` solo deja escribir las
 * propias.
 */

type Supabase = ReturnType<typeof createAdminClient>

export const TABLA_INEXISTENTE = '42P01'
export const COLUMNA_INEXISTENTE = '42703'

export function faltaMigracion(error: { code?: string } | null | undefined): boolean {
  return error?.code === TABLA_INEXISTENTE || error?.code === COLUMNA_INEXISTENTE
}

export type TipoTarea = 'triaje_agenda' | 'asociar_lead' | 'reporte_llamada'

const HORA = 3_600_000

/**
 * El plazo del triaje: 24 h desde que se agendó o 2 h antes de la llamada, lo
 * que ocurra primero.
 *
 * Las 2 h de margen son para que el closer alcance a leer la ficha. Un triaje
 * hecho cinco minutos antes de la llamada no le sirve a nadie.
 */
export function vencimientoTriaje(agendadoAt: string, horaLlamada: string | null): string {
  const porAgendado = new Date(agendadoAt).getTime() + 24 * HORA
  if (!horaLlamada) return new Date(porAgendado).toISOString()
  const porLlamada = new Date(horaLlamada).getTime() - 2 * HORA
  return new Date(Math.min(porAgendado, porLlamada)).toISOString()
}

/** Minutos de postergación que se ofrecen, según cuánto falta para vencer. */
export interface OpcionPosponer {
  etiqueta: string
  minutos: number
}

/**
 * Las opciones de posponer se achican a medida que se acerca el vencimiento.
 *
 * Si posponer fuera libre, se convertiría en el mismo olvido de antes, solo que
 * más lento. Vencida: ninguna opción, solo hacerla o reasignarla. A menos de
 * 2 h: solo 15 minutos.
 */
export function opcionesPosponer(venceAt: string | null, ahora = Date.now()): OpcionPosponer[] {
  if (!venceAt) return [{ etiqueta: '1 hora', minutos: 60 }, { etiqueta: '3 horas', minutos: 180 }]
  const falta = new Date(venceAt).getTime() - ahora
  if (falta <= 0) return []
  if (falta < 2 * HORA) return [{ etiqueta: '15 minutos', minutos: 15 }]

  const opciones: OpcionPosponer[] = [{ etiqueta: '1 hora', minutos: 60 }]
  if (falta > 3 * HORA) opciones.push({ etiqueta: '3 horas', minutos: 180 })

  // "Mañana 9:00" en hora de Chile, solo si mañana a esa hora todavía no venció.
  const manana = mananaALas9Chile(ahora)
  if (manana < new Date(venceAt).getTime()) {
    opciones.push({ etiqueta: 'Mañana 9:00', minutos: Math.round((manana - ahora) / 60_000) })
  }
  return opciones
}

function mananaALas9Chile(ahora: number): number {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false,
  }).formatToParts(new Date(ahora))
  const get = (t: string) => Number(partes.find((p) => p.type === t)?.value)
  const horaLocal = get('hour')
  // Diferencia entre la hora local de Chile y UTC en este instante.
  const utcHora = new Date(ahora).getUTCHours()
  const offset = ((horaLocal - utcHora + 36) % 24) - 12
  const base = Date.UTC(get('year'), get('month') - 1, get('day') + 1, 9 - offset, 0, 0)
  return base
}

/** A la tercera postergación, la tarea escala. */
export const POSTERGACIONES_PARA_ESCALAR = 3

/**
 * La persona responsable de la dirección de ventas del cliente (ver 039).
 *
 * Si no hay nadie asignado, devuelve null y la tarea queda visible para los
 * admins: una tarea sin dueño pero visible es mejor que una asignada a un
 * nombre adivinado.
 */
export async function direccionDeVentas(supabase: Supabase, clientId: string): Promise<string | null> {
  const { data } = await supabase
    .from('team_assignments')
    .select('user_id, is_primary')
    .eq('client_id', clientId)
    .eq('responsibility', 'sales_direction')
    .order('is_primary', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.user_id as string | undefined) ?? null
}

/** Sin tildes ni mayúsculas, para cruzar el texto libre de la planilla con usuarios. */
function normalizar(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * El usuario que corresponde a un nombre escrito en la planilla.
 *
 * Setter y closer son texto libre (mucha gente del cliente no tiene cuenta), así
 * que el cruce es por nombre. Si no hay cuenta con ese nombre no hay a quién
 * avisarle, y se devuelve null.
 */
export async function usuarioPorNombre(
  supabase: Supabase,
  clientId: string,
  nombre: string | null | undefined
): Promise<string | null> {
  if (!nombre?.trim()) return null
  const { data } = await supabase
    .from('users')
    .select('id, full_name, client_id, role')
    .eq('user_type', 'agency')
  const buscado = normalizar(nombre)
  const candidatos = (data ?? []).filter((u) => u.full_name && normalizar(u.full_name as string) === buscado)
  const delCliente = candidatos.find((u) => u.client_id === clientId || u.role === 'admin')
  return ((delCliente ?? candidatos[0])?.id as string | undefined) ?? null
}

/**
 * A quién avisarle que la ficha está lista: el closer escrito en la agenda; si
 * no hay, el closer asignado al cliente; y si tampoco, la dirección de ventas,
 * que hoy es quien toma las llamadas.
 */
export async function closerDeLaAgenda(
  supabase: Supabase,
  clientId: string,
  closerTexto: string | null
): Promise<string | null> {
  const porNombre = await usuarioPorNombre(supabase, clientId, closerTexto)
  if (porNombre) return porNombre

  const { data } = await supabase
    .from('team_assignments')
    .select('user_id')
    .eq('client_id', clientId)
    .eq('responsibility', 'closing')
    .order('is_primary', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (data?.user_id) return data.user_id as string

  return direccionDeVentas(supabase, clientId)
}

/** Los admins activos. Son quienes reciben las escalaciones. */
export async function admins(supabase: Supabase): Promise<string[]> {
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('user_type', 'agency')
    .eq('role', 'admin')
    .eq('is_active', true)
  return (data ?? []).map((u) => u.id as string)
}

export interface Aviso {
  titulo: string
  cuerpo: string
  severidad: 'info' | 'warning' | 'critical'
  agendaId: string | null
}

/**
 * Deja una notificación para cada persona. Nunca lanza: un aviso que no se
 * pudo escribir no puede deshacer la ficha que ya se guardó.
 */
export async function notificar(supabase: Supabase, usuarios: (string | null)[], aviso: Aviso): Promise<void> {
  const destino = [...new Set(usuarios.filter((u): u is string => !!u))]
  if (destino.length === 0) return
  const { error } = await supabase.from('notifications').insert(
    destino.map((user_id) => ({
      user_id,
      title: aviso.titulo,
      body: aviso.cuerpo,
      type: aviso.severidad === 'info' ? 'system' : 'alert',
      severity: aviso.severidad,
      reference_type: aviso.agendaId ? 'agenda_record' : null,
      reference_id: aviso.agendaId,
    }))
  )
  if (error) console.error(`[pipeline-agendas] no se pudo notificar: ${error.message}`)
}

/**
 * Escala un triaje: le avisa a los admins y al closer que va a entrar sin ficha.
 *
 * Se marca escalada_at para no repetir el aviso en cada vuelta del barrido.
 */
export async function escalarTriaje(
  supabase: Supabase,
  tarea: { id: string; client_id: string; agenda_record_id: string | null; pospuesta_veces: number },
  motivo: 'postergada' | 'vencida'
): Promise<void> {
  const { data: agenda } = tarea.agenda_record_id
    ? await supabase
        .from('agenda_records')
        .select('nombre_lead, hora_agenda, closer')
        .eq('id', tarea.agenda_record_id)
        .maybeSingle()
    : { data: null }

  const nombre = (agenda?.nombre_lead as string | null) ?? 'una agenda'
  const cuando = agenda?.hora_agenda
    ? new Date(agenda.hora_agenda as string).toLocaleString('es-CL', {
        timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      })
    : 'fecha sin hora'

  const detalle = motivo === 'vencida'
    ? 'venció sin hacerse'
    : `se pospuso ${tarea.pospuesta_veces} veces`

  const [adminIds, closer] = await Promise.all([
    admins(supabase),
    closerDeLaAgenda(supabase, tarea.client_id, (agenda?.closer as string | null) ?? null),
  ])

  await notificar(supabase, adminIds, {
    titulo: `Triaje escalado: ${nombre}`,
    cuerpo: `El triaje de la llamada del ${cuando} ${detalle}.`,
    severidad: 'critical',
    agendaId: tarea.agenda_record_id,
  })
  await notificar(supabase, [closer], {
    titulo: `Vas a entrar sin ficha: ${nombre}`,
    cuerpo: `El triaje de la llamada del ${cuando} ${detalle}. Revisa el formulario de la reserva antes de entrar.`,
    severidad: 'warning',
    agendaId: tarea.agenda_record_id,
  })

  await supabase.from('system_tasks').update({ escalada_at: new Date().toISOString() }).eq('id', tarea.id)
}
