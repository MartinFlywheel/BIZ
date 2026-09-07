import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { listarCambios, credencialesConfiguradas } from '@/lib/services/google-calendar'
import { parsearEventoCalendly } from '@/lib/services/calendly-event'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Comprueba la conexión con Google Calendar sin escribir nada.
 *
 * Conectar esto tiene cuatro pasos que fallan de formas parecidas —faltan las
 * variables, la clave está mal pegada, el calendario no se compartió, o el ID
 * del calendario está mal— y desde el cron todos se ven igual. Esta ruta los
 * separa y dice cuál es.
 *
 * Solo lee: hace un events.list sin syncToken y muestra lo que encontró. No
 * crea agendas ni guarda el syncToken, así que se puede llamar las veces que
 * haga falta mientras se configura.
 *
 * Uso: /api/debug/calendar-check?clientId=<uuid>
 * Sin clientId, revisa todos los clientes que tengan calendario configurado.
 */
export async function GET(request: Request) {
  if (!credencialesConfiguradas()) {
    return NextResponse.json({
      ok: false,
      paso: 'credenciales',
      problema: 'Faltan GOOGLE_SA_EMAIL o GOOGLE_SA_PRIVATE_KEY en Vercel',
      ayuda: 'Agrégalas en Settings → Environment Variables y vuelve a desplegar: un deploy ya hecho no toma variables nuevas.',
    })
  }

  const clientIdPedido = new URL(request.url).searchParams.get('clientId')
  const supabase = createAdminClient()

  let query = supabase.from('clients').select('id, name, google_calendar_id, google_calendar_synced_at')
  if (clientIdPedido) query = query.eq('id', clientIdPedido)

  const { data: clientes, error } = await query

  if (error) {
    return NextResponse.json({
      ok: false,
      paso: 'migracion',
      problema: error.message,
      ayuda: error.code === '42703'
        ? 'Falta correr supabase/049-agenda-google-calendar.sql en el editor SQL de Supabase.'
        : null,
    })
  }

  const configurados = (clientes ?? []).filter((c) => c.google_calendar_id)

  if (configurados.length === 0) {
    return NextResponse.json({
      ok: false,
      paso: 'calendario_del_cliente',
      problema: 'Ningún cliente tiene google_calendar_id configurado',
      ayuda: 'Copia el ID del calendario desde Google Calendar y guárdalo con UPDATE clients SET google_calendar_id = ... WHERE id = ...',
      clientes: (clientes ?? []).map((c) => ({ id: c.id, nombre: c.name })),
    })
  }

  const resultados = []

  for (const c of configurados) {
    try {
      const { eventos } = await listarCambios(c.google_calendar_id as string, null, 1)

      // Los eventos de Calendly se reconocen por el enlace de cancelación que
      // Calendly escribe en la descripción. Si hay eventos pero ninguno es de
      // Calendly, el calendario es el equivocado.
      const deCalendly = eventos
        .filter((e) => e.status !== 'cancelled')
        .map((e) => ({ evento: e, datos: parsearEventoCalendly(e.description) }))
        .filter((x) => x.datos.calendlyUuid)

      resultados.push({
        cliente: c.name,
        clientId: c.id,
        calendario: c.google_calendar_id,
        acceso: 'ok',
        eventosLeidos: eventos.length,
        eventosDeCalendly: deCalendly.length,
        ultimaSincronizacion: c.google_calendar_synced_at ?? 'nunca',
        // Una muestra para confirmar a ojo que el parser está sacando bien los
        // datos antes de que esto empiece a crear agendas de verdad.
        muestra: deCalendly.slice(0, 3).map((x) => ({
          cuando: x.evento.start?.dateTime ?? x.evento.start?.date ?? null,
          nombre: x.datos.nombre,
          email: x.datos.email,
          instagram: x.datos.instagram,
          telefono: x.datos.telefono,
          tipoEvento: x.datos.tipoEvento,
          respuestas: x.datos.respuestas,
        })),
      })
    } catch (e) {
      const err = e as { status?: number; message?: string }
      resultados.push({
        cliente: c.name,
        clientId: c.id,
        calendario: c.google_calendar_id,
        acceso: 'error',
        status: err.status ?? null,
        problema: err.message ?? String(e),
        ayuda: ayudaSegunStatus(err.status),
      })
    }
  }

  return NextResponse.json({ ok: resultados.every((r) => r.acceso === 'ok'), resultados })
}

/** Traduce los errores de Google al paso de la configuración que hay que revisar. */
function ayudaSegunStatus(status?: number): string | null {
  if (status === 401) {
    return 'Google rechazó la clave. Revisa que GOOGLE_SA_PRIVATE_KEY esté pegada completa, con las líneas BEGIN y END, y que esa clave siga existiendo en la cuenta de servicio (si la borraste, deja de servir).'
  }
  if (status === 403) {
    return 'La clave es válida pero no hay permiso. Falta habilitar la Google Calendar API en el proyecto, o compartir el calendario con el correo de la cuenta de servicio.'
  }
  if (status === 404) {
    return 'El calendario no existe o la cuenta de servicio no lo ve. Revisa que google_calendar_id sea el ID exacto que aparece en la configuración del calendario, y que esté compartido con la cuenta de servicio.'
  }
  return null
}
