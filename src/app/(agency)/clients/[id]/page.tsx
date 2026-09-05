import { Suspense } from 'react'
import { unstable_noStore } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getClient, getClientOptions } from '@/lib/actions/clients'
import { getClientTabCounts } from '@/lib/actions/client-tab-counts'
import { ClientDetail } from '@/components/clients/client-detail'
import { notFound } from 'next/navigation'

// Server Actions invoked from this page's client components (CrmTabLazy's
// getLeadsForViewer/getInteractions, in particular) run under this route's
// function budget. Vercel's default (10s on Hobby) isn't enough for a
// client with a large lead volume — a 3-way-joined, paginated query can run
// past it, killing the request with no error surfaced to the browser.
export const maxDuration = 60

/**
 * Un error de PostgREST serializado entero.
 *
 * `console.error(e)` sobre uno de estos imprime `{ message: '' }` y nada más
 * cuando el fallo es de transporte, que no dice cuál consulta reventó ni por
 * qué. Con code/details/hint al menos queda algo accionable en los logs.
 */
function describirError(e: unknown): string {
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    return JSON.stringify({
      message: o.message ?? null,
      code: o.code ?? null,
      details: o.details ?? null,
      hint: o.hint ?? null,
      name: o.name ?? null,
    })
  }
  return String(e)
}

/**
 * Corre algo accesorio: si falla, lo deja en los logs y sigue con un valor por
 * defecto.
 *
 * Los contadores de las pestañas y la lista del selector son adorno. Antes
 * iban junto al cliente en un solo Promise.all, así que cualquiera de los seis
 * que fallara se llevaba la página entera con un "This page couldn't load".
 * Una pantalla que funciona no debería morir porque un numerito no cargó.
 */
async function accesorio<T>(fn: () => Promise<T>, porDefecto: T, nombre: string, clientId: string): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    console.error(`[ClientDetailPage] ${nombre} falló para ${clientId}:`, describirError(e))
    return porDefecto
  }
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  unstable_noStore()

  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  const { data: viewer } = authUser
    ? await supabase.from('users').select('role').eq('id', authUser.id).single()
    : { data: null }
  const isAdmin = viewer?.role === 'admin'
  const isSetter = viewer?.role === 'setter'

  // El cliente es lo único imprescindible: sin él no hay nada que mostrar. Se
  // pide solo y primero, para que su fallo no se confunda con el de un adorno.
  //
  // Con un reintento: los fallos que estaban tumbando esta pantalla llegaban
  // como `{ message: '' }`, sin código ni detalle — la firma de un corte de
  // transporte contra Supabase, no de una consulta mal escrita. Eso pasa y se
  // va; convertirlo en una pantalla blanca es desproporcionado cuando volver a
  // pedir lo mismo 300 ms después casi siempre funciona.
  let client: Awaited<ReturnType<typeof getClient>>
  try {
    client = await getClient(id).catch(async (e) => {
      // Un 404 real no se reintenta: no va a aparecer en el segundo intento.
      if ((e as { code?: string })?.code === 'PGRST116') throw e
      console.warn(`[ClientDetailPage] reintentando cliente ${id} tras:`, describirError(e))
      await new Promise((r) => setTimeout(r, 300))
      return getClient(id)
    })
  } catch (e) {
    console.error(`[ClientDetailPage] no se pudo cargar el cliente ${id}:`, describirError(e))
    // PGRST116 = .single() no devolvió filas: el cliente de verdad no existe.
    // Cualquier otra cosa es un fallo real y sube como tal — disfrazarlo de
    // 404 fue lo que hizo invisible el timeout de Postgres durante horas.
    if ((e as { code?: string })?.code === 'PGRST116') notFound()
    throw e
  }

  // Todo lo demás degrada. Los cuatro contadores viajan juntos en una sola
  // consulta (supabase/047) en vez de cuatro conexiones separadas: en el plan
  // free el pool es chico y esta página compite con la pestaña abierta, el
  // panel de tareas y el tablero de contenido.
  const [allClients, counts] = await Promise.all([
    accesorio(() => getClientOptions(), [], 'getClientOptions', id),
    accesorio(
      () => getClientTabCounts(id),
      { contentPieces: 0, leads: 0, calls: 0, competitors: 0 },
      'getClientTabCounts',
      id
    ),
  ])

  return (
    <Suspense fallback={null}>
      <ClientDetail
        client={client}
        allClients={allClients}
        contentPiecesCount={counts.contentPieces}
        leadsCount={counts.leads}
        callsCount={counts.calls}
        competitorsCount={counts.competitors}
        isAdmin={isAdmin}
        isSetter={isSetter}
        currentUserId={authUser?.id}
      />
    </Suspense>
  )
}
