'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DatosLlamadas } from '@/lib/actions/llamadas'
import { ListaLlamadas } from './lista-llamadas'

/**
 * Página /calls: las llamadas de todos los clientes, con la misma fuente que la
 * pestaña del cliente. Registrar una llamada se hace desde la pestaña del
 * cliente, que es donde se sabe a qué cliente pertenece el lead.
 */
export function LlamadasGlobal({ datos, dias }: { datos: DatosLlamadas; dias: number }) {
  const router = useRouter()
  const [cliente, setCliente] = useState('')

  const clientes = useMemo(() => {
    const mapa = new Map<string, string>()
    for (const l of datos.llamadas) {
      if (l.clientId) mapa.set(l.clientId, l.clienteNombre ?? mapa.get(l.clientId) ?? 'Sin nombre')
    }
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'))
  }, [datos.llamadas])

  // Los nombres de cliente de las grabaciones sueltas no vienen en la fila:
  // se completan con los de las agendas del mismo cliente.
  const nombres = useMemo(() => new Map(clientes), [clientes])
  const filtradas = useMemo<DatosLlamadas>(() => ({
    ...datos,
    llamadas: datos.llamadas
      .filter((l) => !cliente || l.clientId === cliente || (cliente === 'sin_cliente' && !l.clientId))
      .map((l) => (l.clienteNombre || !l.clientId ? l : { ...l, clienteNombre: nombres.get(l.clientId) ?? null })),
  }), [datos, cliente, nombres])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">Llamadas de ventas</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Últimos {dias} días de todos los clientes. Para registrar una llamada, entra a la pestaña Llamadas del cliente.
          </p>
        </div>
        <select
          value={cliente}
          onChange={(e) => setCliente(e.target.value)}
          className="h-9 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 focus:outline-none"
          aria-label="Filtrar por cliente"
        >
          <option value="">Todos los clientes</option>
          {clientes.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
          <option value="sin_cliente">Grabaciones sin cliente</option>
        </select>
      </div>

      <ListaLlamadas datos={filtradas} mostrarCliente={!cliente} onCambio={() => router.refresh()} />
    </div>
  )
}
