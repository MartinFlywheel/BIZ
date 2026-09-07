import { NextResponse } from 'next/server'
import { logCronRun } from '@/lib/cron-log'
import { sincronizarAgendas } from '@/lib/services/agenda-sync'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Lee los calendarios de Google de todos los clientes que lo tengan
// configurado y convierte las reservas de Calendly en agendas del CRM.
// Se programa desde pg_cron, no desde vercel.json: el plan Hobby solo permite
// un cron diario y esto tiene que correr cada pocos minutos para que la agenda
// aparezca mientras el setter todavia esta trabajando.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const resultado = await sincronizarAgendas()

  const totales = resultado.resultados.reduce(
    (acc, r) => ({
      creadas: acc.creadas + r.creadas,
      actualizadas: acc.actualizadas + r.actualizadas,
      canceladas: acc.canceladas + r.canceladas,
      sinLead: acc.sinLead + r.sinLead,
      notetakerInvitada: acc.notetakerInvitada + r.notetakerInvitada,
      conError: acc.conError + (r.error ? 1 : 0),
    }),
    { creadas: 0, actualizadas: 0, canceladas: 0, sinLead: 0, notetakerInvitada: 0, conError: 0 }
  )

  await logCronRun('sync-agendas', {
    ...totales,
    clientes: resultado.resultados.length,
    motivo: resultado.motivo ?? null,
    errores: resultado.resultados.filter((r) => r.error).map((r) => `${r.cliente}: ${r.error}`),
  })

  return NextResponse.json({ ok: resultado.ok, ...totales, detalle: resultado.resultados })
}
