import { createHmac, timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sincronizarFathom } from '@/lib/services/fathom-sync'
import type { ReunionFathom } from '@/lib/services/fathom'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// Webhook "New meeting content ready" de Fathom.
//
// El payload es el mismo objeto de reunión que devuelve GET /meetings, así que
// pasa por el mismo camino que el cron: se guarda en fathom_grabaciones y se
// cruza por puntaje con las agendas. Antes escribía en sales_calls buscando el
// lead solo por correo, en todos los clientes a la vez, y nada de eso llegaba a
// la agenda ni al reporte. Hasta hoy nunca recibió un evento (0 filas en
// webhook_logs): el cron sync-fathom sigue siendo el camino principal y este
// webhook solo adelanta la llegada de la grabación.
//
// Cada llamada se registra en webhook_logs pase lo que pase, para poder
// corregir el parseo con payloads reales sin perder datos.
//
// Firma: si FATHOM_WEBHOOK_SECRET está configurado ("whsec_..."), se exige.
// Sin la variable deja pasar, igual que el webhook de ManyChat: primero se
// crea el webhook en Fathom y recién después se guarda el secreto en Vercel.

const TOLERANCIA_SEGUNDOS = 300

function firmaValida(secreto: string, headers: Headers, cuerpo: string): boolean {
  const id = headers.get('webhook-id')
  const timestamp = headers.get('webhook-timestamp')
  const firma = headers.get('webhook-signature')
  if (!id || !timestamp || !firma) return false

  const ts = parseInt(timestamp, 10)
  if (Number.isNaN(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > TOLERANCIA_SEGUNDOS) return false

  const clave = Buffer.from(secreto.split('_')[1] ?? secreto, 'base64')
  const esperada = createHmac('sha256', clave).update(`${id}.${timestamp}.${cuerpo}`).digest('base64')

  return firma.split(' ').some((parte) => {
    const recibida = parte.includes(',') ? parte.split(',')[1] : parte
    const a = Buffer.from(esperada)
    const b = Buffer.from(recibida)
    return a.length === b.length && timingSafeEqual(a, b)
  })
}

export async function POST(request: Request) {
  const supabase = createAdminClient()
  let webhookLogId: string | null = null

  try {
    const cuerpo = await request.text()

    const secreto = process.env.FATHOM_WEBHOOK_SECRET
    if (secreto && !firmaValida(secreto, request.headers, cuerpo)) {
      return NextResponse.json({ error: 'Firma inválida' }, { status: 401 })
    }

    const body = JSON.parse(cuerpo) as ReunionFathom & { event?: string }

    const { data: logRow } = await supabase
      .from('webhook_logs')
      .insert({ source: 'fathom', event_type: body?.event || 'new_meeting_content_ready', payload: body, processed: false })
      .select('id')
      .single()
    webhookLogId = logRow?.id || null

    if (body?.recording_id === undefined || body?.recording_id === null || body?.recording_id === '') {
      await markLog(supabase, webhookLogId, 'El payload no trae recording_id')
      return NextResponse.json({ received: true, warning: 'Sin recording_id: queda registrado para revisarlo a mano' })
    }

    // Sin reintento de las viejas: eso lo hace el cron. Aquí solo interesa la
    // reunión que acaba de llegar.
    const { ok, motivo, resumen, detalle } = await sincronizarFathom({ reuniones: [body], reintentar: false })

    await markLog(supabase, webhookLogId, ok ? null : motivo ?? 'Error al sincronizar')
    return NextResponse.json({ received: true, ok, motivo: motivo ?? null, resumen, detalle })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido'
    console.error('[Fathom] Error:', msg)
    await markLog(supabase, webhookLogId, msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function markLog(
  supabase: ReturnType<typeof createAdminClient>,
  logId: string | null,
  error: string | null
) {
  if (!logId) return
  await supabase.from('webhook_logs').update({ processed: true, error }).eq('id', logId)
}
