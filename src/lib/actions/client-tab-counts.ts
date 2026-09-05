'use server'

import { createClient } from '@/lib/supabase/server'
import { getContentPiecesCount } from '@/lib/actions/content'
import { getLeadsCount } from '@/lib/actions/leads'
import { getCallsCount } from '@/lib/actions/calls'
import { getCompetitorsCount } from '@/lib/actions/competitors'

export interface ClientTabCounts {
  contentPieces: number
  leads: number
  calls: number
  competitors: number
}

/**
 * Los cuatro números que van al lado del nombre de cada pestaña del detalle de
 * cliente, en UNA consulta.
 *
 * Antes eran cuatro consultas paralelas, una por tabla, para cuatro enteros.
 * En el plan free de Supabase el pool de conexiones es chico y esta página no
 * está sola: encima corren las consultas de la pestaña abierta, el panel de
 * tareas y el tablero de contenido. Bajo esa presión aparecían errores de
 * transporte sin código ni mensaje —`{ message: '' }` en los logs de Vercel—
 * que no venían de ninguna consulta en particular, sino de quedarse sin
 * conexión disponible.
 *
 * Si la función de Postgres todavía no existe (migración 047 sin correr), cae
 * a las cuatro consultas de siempre en vez de romper. Desplegar código que
 * depende de una migración sin aplicar ya tumbó el CRM una vez.
 */
export async function getClientTabCounts(clientId: string): Promise<ClientTabCounts> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('client_tab_counts', { p_client_id: clientId })

  if (!error && Array.isArray(data) && data.length > 0) {
    const fila = data[0] as Record<string, unknown>
    return {
      contentPieces: Number(fila.content_pieces) || 0,
      leads: Number(fila.leads) || 0,
      calls: Number(fila.calls) || 0,
      competitors: Number(fila.competitors) || 0,
    }
  }

  console.warn('[client-tab-counts] client_tab_counts no disponible, usando las consultas sueltas:', error?.message)

  const [contentPieces, leads, calls, competitors] = await Promise.all([
    getContentPiecesCount(clientId),
    getLeadsCount(clientId),
    getCallsCount(clientId),
    getCompetitorsCount(clientId),
  ])

  return { contentPieces, leads, calls, competitors }
}
