import { NextResponse } from 'next/server'
import { logCronRun } from '@/lib/cron-log'
import { sincronizarFathom } from '@/lib/services/fathom-sync'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Busca en Fathom las grabaciones de las llamadas ya ocurridas y las engancha a
// la agenda que les corresponde, para que el reporte de llamadas se arme solo.
//
// Se programa desde pg_cron cada 30 minutos: la grabacion recien existe cuando
// la llamada termino y Fathom se demora unos minutos en procesarla, asi que
// buscarla mas seguido solo gasta llamadas a la API.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { ok, motivo, resumen } = await sincronizarFathom()

  await logCronRun('sync-fathom', { ...resumen, motivo: motivo ?? null })

  return NextResponse.json({ ok, motivo: motivo ?? null, ...resumen })
}
