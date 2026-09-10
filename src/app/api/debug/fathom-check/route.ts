import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { listarReuniones, correosExternos, credencialesConfiguradas } from '@/lib/services/fathom'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Comprueba, sin escribir nada, si el circuito de Fathom está funcionando.
 *
 * Son dos cosas distintas que desde afuera se confunden:
 *
 * 1. Que Fathom entre a la llamada y la grabe. Eso no lo hace el CRM: lo hace
 *    la integración de Fathom con Google Meet. Si acá no aparece ninguna
 *    reunión, el problema está en Fathom, no en el CRM.
 * 2. Que la grabación llegue a la agenda del CRM. Eso sí es nuestro, y es lo
 *    que hace el cron sync-fathom.
 *
 * Esta ruta las separa: muestra qué ve Fathom y, para cada reunión, si el CRM
 * ya la enganchó a una agenda o no, y por qué.
 *
 * Uso: /api/debug/fathom-check?dias=14
 */

const COLUMNA_INEXISTENTE = '42703'

export async function GET(request: Request) {
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

  // Las agendas de la misma ventana, para poder decir cuáles quedaron sin
  // grabación y cuáles ya la tienen.
  const { data: agendas, error } = await supabase
    .from('agenda_records')
    .select('id, nombre_lead, hora_agenda, email_lead, fathom_recording_id, link_reporte')
    .not('hora_agenda', 'is', null)
    .gte('hora_agenda', desde.toISOString())

  if (error) {
    return NextResponse.json({
      ok: false,
      paso: 'migracion',
      problema: error.message,
      ayuda: error.code === COLUMNA_INEXISTENTE
        ? 'Falta correr supabase/052-fathom-grabaciones.sql en el editor SQL de Supabase.'
        : null,
      reunionesEnFathom: reuniones.length,
    })
  }

  const enganchadas = new Set(
    (agendas ?? []).map((a) => a.fathom_recording_id).filter(Boolean) as string[]
  )

  return NextResponse.json({
    ok: true,
    diasRevisados: dias,

    // Paso 1: ¿Fathom está grabando? Si esto es 0, no hay nada que traer y el
    // problema está en la integración de Fathom con Meet, no en el CRM.
    reunionesEnFathom: reuniones.length,

    grabaciones: reuniones.slice(0, 20).map((r) => ({
      titulo: r.meeting_title ?? r.title ?? '(sin título)',
      cuando: r.scheduled_start_time ?? r.recording_start_time ?? null,
      invitadosExternos: correosExternos(r),
      tieneEnlace: !!(r.share_url ?? r.url),
      tieneResumen: !!r.default_summary?.markdown_formatted,
      // Lo que decide si el CRM la puede enganchar.
      yaEnganchada: r.recording_id ? enganchadas.has(r.recording_id) : false,
    })),

    // Paso 2: ¿el CRM las está enganchando?
    agendasEnLaVentana: agendas?.length ?? 0,
    agendasConGrabacion: (agendas ?? []).filter((a) => a.fathom_recording_id).length,

    agendasSinGrabacion: (agendas ?? [])
      .filter((a) => !a.fathom_recording_id)
      .slice(0, 20)
      .map((a) => ({
        nombre: a.nombre_lead,
        cuando: a.hora_agenda,
        email: a.email_lead,
      })),
  })
}
