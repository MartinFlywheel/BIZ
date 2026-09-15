'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ListaLlamadas } from '@/components/llamadas/lista-llamadas'
import { getLlamadasCliente, type DatosLlamadas } from '@/lib/actions/llamadas'

/**
 * Pestaña Llamadas del cliente.
 *
 * Antes leía sales_calls (9 filas cargadas a mano en agosto) y no mostraba
 * ninguna grabación de Fathom. Ahora sale de las agendas: ver
 * src/lib/actions/llamadas.ts.
 *
 * Los datos se piden solo cuando la pestaña se abre, igual que antes: la página
 * del cliente no carga llamadas si nadie entra aquí. Y ya no se cargan todos
 * los leads del cliente para ponerle nombre a cada fila: el nombre viene con la
 * agenda, y el formulario busca leads bajo demanda.
 */
export function ClientCallsListLazy({ clientId }: { clientId: string }) {
  const [datos, setDatos] = useState<DatosLlamadas | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [intento, setIntento] = useState(0)

  const recargar = useCallback(() => {
    getLlamadasCliente(clientId)
      .then((r) => setDatos(r))
      .catch((err) => console.error('[ClientCallsList] no se pudo recargar', err))
  }, [clientId])

  useEffect(() => {
    let cancelado = false
    getLlamadasCliente(clientId)
      .then((r) => { if (!cancelado) { setDatos(r); setError(null) } })
      .catch((err) => { if (!cancelado) setError(err instanceof Error ? err.message : 'Error inesperado') })
    return () => { cancelado = true }
  }, [clientId, intento])

  if (error) {
    return (
      <div className="py-16 text-center text-sm">
        <p className="mb-3 text-red-400">No se pudieron cargar las llamadas ({error}).</p>
        <Button variant="secondary" size="sm" onClick={() => { setError(null); setIntento((a) => a + 1) }}>Reintentar</Button>
      </div>
    )
  }

  if (!datos) {
    return <div className="animate-pulse py-16 text-center text-sm text-zinc-500">Cargando llamadas...</div>
  }

  return <ListaLlamadas datos={datos} clientId={clientId} onCambio={recargar} />
}
