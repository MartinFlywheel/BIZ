import { NextResponse } from 'next/server'
import { logCronRun } from '@/lib/cron-log'
import { sincronizarFathom } from '@/lib/services/fathom-sync'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// Busca en Fathom las grabaciones de las llamadas ya ocurridas, las guarda en
// fathom_grabaciones y las engancha a la agenda que les corresponde, para que
// el reporte de llamadas se arme solo. También reintenta las grabaciones de los
// últimos 30 días que todavía no tienen agenda.
//
// Se programa desde pg_cron cada 30 minutos: la grabacion recien existe cuando
// la llamada termino y Fathom se demora unos minutos en procesarla, asi que
// buscarla mas seguido solo gasta llamadas a la API.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { ok, motivo, resumen, detalle } = await sincronizarFathom()

  // El detalle va solo en la respuesta: en cron_runs basta el resumen, y el
  // detalle por grabación se consulta en /api/debug/fathom-check.
  await logCronRun('sync-fathom', { ...resumen, motivo: motivo ?? null })

  return NextResponse.json({ ok, motivo: motivo ?? null, ...resumen, detalle })
}
