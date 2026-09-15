import { NextResponse } from 'next/server'
import { getMisTareas } from '@/lib/actions/triage'
import { getUsuarioActivoParaApi } from '@/lib/supabase/session'

export const dynamic = 'force-dynamic'

/**
 * Las tareas del Pipeline de Agendas de quien mira, para el aviso global.
 *
 * Existe porque el aviso (system-tasks-toast.tsx) consultaba cada 45 segundos
 * con la server action getMisTareas. Next despacha las server actions del
 * navegador de a una, así que cada consulta del aviso se metía en la misma
 * cola que la carga de la pestaña abierta y la hacía esperar. Un fetch a un
 * route handler no entra en esa cola. Las escrituras (posponer, reasignar)
 * siguen siendo server actions.
 *
 * La lógica es la misma getMisTareas: sin sesión o sin perfil de agencia
 * devuelve una lista vacía, igual que antes.
 */
export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store' }

  const user = await getUsuarioActivoParaApi()
  if (!user) return NextResponse.json([], { status: 401, headers })

  const tareas = await getMisTareas()
  return NextResponse.json(tareas, { headers })
}
