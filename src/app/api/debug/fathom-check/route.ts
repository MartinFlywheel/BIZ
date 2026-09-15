import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { listarReuniones, credencialesConfiguradas } from '@/lib/services/fathom'
import {
  cargarCandidatas,
  evaluarGrabacion,
  grabacionDesdeReunion,
  momentoDe,
  puntuarCandidata,
  PUNTAJE_AUTO,
  PUNTAJE_SUGERENCIA,
  VENTAJA_MINIMA,
} from '@/lib/services/fathom-sync'
import { exigirCronSecret } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Comprueba, sin escribir nada, si el circuito de Fathom está funcionando.
 *
 * Son dos cosas distintas que desde afuera se confunden:
 *
 * 1. Que Fathom entre a la llamada y la grabe. Eso no lo hace el CRM: lo hace
 *    la integración de Fathom con Google Meet. Si aquí no aparece ninguna
 *    reunión, el problema está en Fathom (o la llamada la grabó otra cuenta),
 *    no en el CRM.
 * 2. Que la grabación llegue a la agenda del CRM. Eso sí es nuestro, y es lo
 *    que hace el cron sync-fathom.
 *
 * Por cada reunión muestra lo que faltó en la investigación original: el
 * recording_id, quién grabó, las horas por separado, el título, las agendas
 * candidatas con su puntaje y por qué no se asoció.
 *
 * Uso: /api/debug/fathom-check?dias=14
 */

const COLUMNA_INEXISTENTE = '42703'

export async function GET(request: Request) {
  // Ruta interna de diagnóstico: solo con la contraseña de los crons.
  const noAutorizado = exigirCronSecret(request)
  if (noAutorizado) return noAutorizado

  if (!credencialesConfiguradas()) {
    return NextResponse.json({
      ok: false,
      paso: 'credenciales',
      problema: 'Falta FATHOM_API_KEY en Vercel',
      ayuda: 'Genérala en Fathom → Settings → API Access → Generate Api Key, guárdala en Settings → Environment Variables y vuelve a desplegar: un deploy ya hecho no toma variables nuevas.',
    })
  }

  const params = new URL(request.url).searchParams
  const dias = Math.min(Math.max(Number(params.get('dias')) || 14, 1), 365)
  const desde = new Date(Date.now() - dias * 86_400_000)

  let reuniones
  try {
    reuniones = await listarReuniones(desde)
  } catch (e) {
    const err = e as { status?: number; message?: string }
    return NextResponse.json({
      ok: false,
      paso: 'api_de_fathom',
      status: err.status ?? null,
      problema: err.message ?? String(e),
      ayuda: err.status === 401
        ? 'Fathom rechazó la clave. Revisa que FATHOM_API_KEY esté completa y que la key siga existiendo en Fathom.'
        : err.status === 403
        ? 'La clave es válida pero no tiene permiso. Puede que la API no esté incluida en el plan actual de Fathom.'
        : null,
    })
  }

  const supabase = createAdminClient()
  const grabaciones = reuniones.map(grabacionDesdeReunion).filter((g) => g !== null)

  // Todas las agendas de la ventana, también las que ya tienen grabación, para
  // poder explicar "esta agenda ya tiene otra".
  const { agendas, error } = await cargarCandidatas(supabase, grabaciones, { incluirConGrabacion: true })
  if (error) {
    return NextResponse.json({
      ok: false,
      paso: 'migracion',
      problema: error.message,
      ayuda: error.code === COLUMNA_INEXISTENTE
        ? 'Falta correr supabase/052-fathom-grabaciones.sql o la 055 en el editor SQL de Supabase.'
        : null,
      reunionesEnFathom: reuniones.length,
    })
  }

  // Estado guardado en la tabla de la 074, si existe.
  const ids = grabaciones.map((g) => g.recordingId)
  const { data: filas, error: errorTabla } = ids.length > 0
    ? await supabase
        .from('fathom_grabaciones')
        .select('recording_id, client_id, agenda_record_id, match_metodo, match_puntaje, sugerida_agenda_id')
        .in('recording_id', ids)
    : { data: [], error: null }
  const guardada = new Map((filas ?? []).map((f) => [String(f.recording_id), f]))

  const sinGrabacion = agendas.filter((a) => !a.fathom_recording_id)

  return NextResponse.json({
    ok: true,
    diasRevisados: dias,
    tablaFathomGrabaciones: errorTabla?.code === '42P01' ? 'falta correr la 074' : 'disponible',
    reglas: { puntajeAuto: PUNTAJE_AUTO, ventajaMinima: VENTAJA_MINIMA, puntajeSugerencia: PUNTAJE_SUGERENCIA },

    // Paso 1: ¿Fathom está grabando? Si esto es 0, no hay nada que traer y el
    // problema está en la integración de Fathom con Meet, no en el CRM.
    reunionesEnFathom: reuniones.length,

    grabaciones: grabaciones.slice(0, 40).map((g) => {
      const asociadaA = agendas.find((a) => a.fathom_recording_id && String(a.fathom_recording_id) === g.recordingId)
      const ev = evaluarGrabacion(g, sinGrabacion)
      // Las que ya tienen otra grabación no compiten, pero se muestran para
      // explicar por qué la agenda "obvia" no se eligió.
      const ocupadas = agendas
        .filter((a) => a.fathom_recording_id && String(a.fathom_recording_id) !== g.recordingId)
        .map((a) => puntuarCandidata(g, a))
        .filter((c) => c !== null && c.puntaje >= PUNTAJE_SUGERENCIA)
        .map((c) => ({ agendaId: c!.agenda.id, nombre: c!.agenda.nombre_lead, puntaje: c!.puntaje, grabacion: c!.agenda.fathom_recording_id }))

      return {
        recordingId: g.recordingId,
        titulo: g.titulo ?? '(sin título)',
        grabadoPor: { nombre: g.grabadoPorNombre, email: g.grabadoPorEmail },
        horaAgendada: g.programada,
        inicioGrabacion: g.inicio,
        finGrabacion: g.fin,
        creadaEnFathom: g.creadaEnFathom,
        referencia: momentoDe(g),
        invitados: g.invitados.map((i) => ({ nombre: i.name ?? null, email: i.email ?? null, externo: i.is_external ?? null })),
        tieneEnlace: !!(g.shareUrl ?? g.url),
        tieneResumen: !!g.resumen,
        enTabla: guardada.get(g.recordingId) ?? null,
        yaAsociadaA: asociadaA ? { agendaId: asociadaA.id, nombre: asociadaA.nombre_lead } : null,
        decision: asociadaA ? 'ya_tenia' : ev.decision,
        motivo: asociadaA ? 'ya estaba asociada' : ev.motivo,
        candidatas: ev.candidatas.slice(0, 5).map((c) => ({
          agendaId: c.agenda.id,
          clientId: c.agenda.client_id,
          nombre: c.agenda.nombre_lead ?? c.agenda.lead_nombre,
          fecha: c.agenda.fecha_agenda,
          hora: c.agenda.hora_agenda,
          closer: c.agenda.closer,
          manual: !c.agenda.google_event_id,
          puntaje: c.puntaje,
          motivos: c.motivos,
        })),
        candidatasConOtraGrabacion: ocupadas.slice(0, 3),
      }
    }),

    // Paso 2: ¿el CRM las está enganchando?
    agendasEnLaVentana: agendas.length,
    agendasConGrabacion: agendas.filter((a) => a.fathom_recording_id).length,
    agendasSinGrabacion: sinGrabacion.slice(0, 30).map((a) => ({
      agendaId: a.id,
      nombre: a.nombre_lead ?? a.lead_nombre,
      fecha: a.fecha_agenda,
      hora: a.hora_agenda,
      email: a.email_lead ?? a.lead_email,
      manual: !a.google_event_id,
    })),
  })
}
