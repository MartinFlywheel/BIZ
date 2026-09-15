import { NextResponse } from 'next/server'
import { syncNotionTasksAction } from '@/lib/actions/tasks'
import { getUsuarioActivoParaApi } from '@/lib/supabase/session'

export const dynamic = 'force-dynamic'
// La sincronización lee el esquema y todas las páginas de la base de Notion.
export const maxDuration = 60

/**
 * Sincronización automática del tablero de tareas con Notion, en segundo plano.
 *
 * El panel de Tareas (tasks-panel.tsx) la lanzaba como server action al abrir
 * la pestaña si la última sincronización tenía más de 3 minutos. Next despacha
 * las server actions del navegador de a una, así que mientras la API de Notion
 * respondía (varios segundos) cualquier otra action de la pantalla quedaba
 * esperando. Por fetch no entra en esa cola.
 *
 * Los permisos son los mismos de syncNotionTasksAction, que se reusa tal cual:
 * sesión, y acceso al cliente.
 */
export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' }

  const user = await getUsuarioActivoParaApi()
  if (!user) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401, headers })

  const body = (await request.json().catch(() => null)) as { clientId?: unknown } | null
  const clientId = typeof body?.clientId === 'string' ? body.clientId : null
  if (!clientId) return NextResponse.json({ success: false, error: 'Falta clientId' }, { status: 400, headers })

  try {
    const result = await syncNotionTasksAction(clientId)
    return NextResponse.json(result, { headers })
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Error inesperado'
    console.error(`[api/tareas/sincronizar-notion] ${clientId}: ${error}`)
    return NextResponse.json({ success: false, error }, { status: 500, headers })
  }
}
