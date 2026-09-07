import { createAdminClient } from '@/lib/supabase/admin'
import {
  listarReuniones,
  correosExternos,
  credencialesConfiguradas,
  type ReunionFathom,
} from './fathom'

/**
 * Pega cada grabación de Fathom a la agenda que le corresponde.
 *
 * Cierra el problema con el que empezó todo: la grabación existe, pero vive en
 * Fathom y alguien tiene que traerla a mano para armar el reporte de llamadas.
 *
 * Depende de la migración 052. Si no se corrió, informa y no hace nada, en vez
 * de reventar el cron.
 */

const COLUMNA_INEXISTENTE = '42703'
const FALTA_MIGRACION = 'Falta correr la migración 052-fathom-grabaciones.sql'

/**
 * Cuánto hacia atrás buscar grabaciones. Una llamada puede terminar y tardar en
 * procesarse, y el cron puede haber estado caído un par de días; siete días da
 * margen sin recorrer el historial completo cada media hora.
 */
const DIAS_HACIA_ATRAS = 7

/**
 * Cuánto puede diferir la hora agendada de la que reporta Fathom para seguir
 * considerándose la misma llamada. Ambas salen del mismo evento de Google
 * Calendar, así que deberían ser idénticas; el margen cubre reprogramaciones
 * que el CRM todavía no sincronizó.
 */
const MINUTOS_DE_MARGEN = 90

export interface ResumenFathom {
  reunionesRevisadas: number
  enganchadas: number
  /** Grabaciones que no se pudieron asociar a ninguna agenda. */
  sinAgenda: number
  yaTenian: number
  error: string | null
}

interface AgendaCandidata {
  id: string
  hora_agenda: string | null
  email_lead: string | null
  nombre_lead: string | null
}

function esErrorDeMigracion(error: { code?: string } | null | undefined): boolean {
  return error?.code === COLUMNA_INEXISTENTE
}

/**
 * Cuál de las agendas pendientes corresponde a esta grabación.
 *
 * El cruce fuerte es la hora: la agenda y la reunión de Fathom salen del mismo
 * evento del calendario. Cuando dos agendas caen dentro del margen —dos
 * llamadas seguidas, o una reprogramada— desempata el correo del invitado.
 *
 * Si sigue habiendo empate no se asocia ninguna: pegarle la grabación de una
 * llamada a la agenda equivocada es peor que dejarla sin grabación, porque
 * nadie lo revisa después y el reporte sale mal sin que se note.
 */
function elegirAgenda(
  reunion: ReunionFathom,
  candidatas: AgendaCandidata[]
): AgendaCandidata | null {
  const inicio = reunion.scheduled_start_time ?? reunion.recording_start_time
  if (!inicio) return null

  const t = new Date(inicio).getTime()
  if (Number.isNaN(t)) return null

  const cerca = candidatas.filter((a) => {
    if (!a.hora_agenda) return false
    const ta = new Date(a.hora_agenda).getTime()
    if (Number.isNaN(ta)) return false
    return Math.abs(ta - t) <= MINUTOS_DE_MARGEN * 60_000
  })

  if (cerca.length === 1) return cerca[0]
  if (cerca.length === 0) return null

  const correos = correosExternos(reunion)
  const porCorreo = cerca.filter(
    (a) => a.email_lead && correos.includes(a.email_lead.toLowerCase())
  )
  return porCorreo.length === 1 ? porCorreo[0] : null
}

/**
 * Trae las grabaciones nuevas y las engancha.
 *
 * Recorre las grabaciones una vez y las cruza contra las agendas sin grabación,
 * en memoria: son decenas de filas, no miles, y hacerlo así evita una consulta
 * por reunión.
 */
export async function sincronizarFathom(): Promise<{
  ok: boolean
  motivo?: string
  resumen: ResumenFathom
}> {
  const resumen: ResumenFathom = {
    reunionesRevisadas: 0,
    enganchadas: 0,
    sinAgenda: 0,
    yaTenian: 0,
    error: null,
  }

  if (!credencialesConfiguradas()) {
    return { ok: false, motivo: 'Falta FATHOM_API_KEY', resumen }
  }

  const supabase = createAdminClient()
  const desde = new Date(Date.now() - DIAS_HACIA_ATRAS * 86_400_000)

  try {
    const reuniones = await listarReuniones(desde)
    resumen.reunionesRevisadas = reuniones.length
    if (reuniones.length === 0) return { ok: true, resumen }

    // Las agendas de la misma ventana que todavía no tienen grabación. Se
    // piden todas de una vez y se cruzan en memoria.
    const { data: agendas, error } = await supabase
      .from('agenda_records')
      .select('id, hora_agenda, email_lead, nombre_lead')
      .is('fathom_recording_id', null)
      .not('hora_agenda', 'is', null)
      .gte('hora_agenda', desde.toISOString())

    if (error) {
      return {
        ok: false,
        motivo: esErrorDeMigracion(error) ? FALTA_MIGRACION : error.message,
        resumen,
      }
    }

    const pendientes = (agendas ?? []) as AgendaCandidata[]

    for (const reunion of reuniones) {
      if (!reunion.recording_id) continue

      const agenda = elegirAgenda(reunion, pendientes)
      if (!agenda) {
        resumen.sinAgenda++
        continue
      }

      const { error: errorUpdate } = await supabase
        .from('agenda_records')
        .update({
          fathom_recording_id: reunion.recording_id,
          fathom_resumen: reunion.default_summary?.markdown_formatted ?? null,
          fathom_sincronizado_at: new Date().toISOString(),
          link_reporte: reunion.share_url ?? reunion.url ?? null,
        })
        .eq('id', agenda.id)

      if (errorUpdate) {
        // El índice único salta si dos grabaciones caen en la misma agenda.
        // No es motivo para cortar el resto: se cuenta y se sigue.
        console.error(
          `[fathom-sync] no se pudo enganchar ${reunion.recording_id} a la agenda ${agenda.id}: ${errorUpdate.message}`
        )
        resumen.sinAgenda++
        continue
      }

      // Se saca de las candidatas para que la siguiente grabación no vuelva a
      // elegir la misma agenda.
      const i = pendientes.indexOf(agenda)
      if (i >= 0) pendientes.splice(i, 1)

      resumen.enganchadas++
    }

    return { ok: true, resumen }
  } catch (e) {
    const error = e as { message?: string }
    resumen.error = error.message ?? String(e)
    return { ok: false, motivo: resumen.error, resumen }
  }
}
