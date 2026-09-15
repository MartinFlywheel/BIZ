'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, Plus } from 'lucide-react'
import {
  crearPiezaParaCodigo,
  getCodigosSinPieza,
  type CodigoSinPieza,
} from '@/lib/actions/manychat-pendientes'
import type { ContentType } from '@/lib/types'

const TIPOS: { valor: ContentType; etiqueta: string }[] = [
  { valor: 'reel', etiqueta: 'Reel' },
  { valor: 'story', etiqueta: 'Historia' },
  { valor: 'post', etiqueta: 'Carrusel' },
]

/** El código dice el tipo por su letra inicial (R_, H_, C_), como en la guía del webhook. */
function tipoSugerido(codigo: string): ContentType {
  const letra = codigo.trim().charAt(0).toUpperCase()
  if (letra === 'H') return 'story'
  if (letra === 'C') return 'post'
  return 'reel'
}

function fecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: 'short' })
}

/**
 * Aviso de códigos de ManyChat que llegan sin pieza.
 *
 * Los chats de esos códigos se registran sin CTA: cuentan como chats del
 * cliente, pero no suman a ninguna pieza. Crear la pieza desde aquí les pasa
 * los chats ya registrados.
 */
export function CodigosSinPieza({ clientId, onPiezaCreada }: { clientId: string; onPiezaCreada?: () => void }) {
  const [codigos, setCodigos] = useState<CodigoSinPieza[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tipos, setTipos] = useState<Record<string, ContentType>>({})
  const [creando, setCreando] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [recarga, setRecarga] = useState(0)

  useEffect(() => {
    let vigente = true
    getCodigosSinPieza(clientId)
      .then((c) => { if (vigente) { setCodigos(c); setError(null) } })
      .catch((e) => { if (vigente) setError(e instanceof Error ? e.message : 'No se pudieron cargar los códigos sin pieza') })
    return () => { vigente = false }
  }, [clientId, recarga])

  async function crear(codigo: string) {
    setCreando(codigo)
    setAviso(null)
    try {
      const r = await crearPiezaParaCodigo(clientId, codigo, tipos[codigo] ?? tipoSugerido(codigo))
      if (!r.ok) {
        setAviso(r.error)
        return
      }
      setAviso(`Pieza ${codigo} creada. ${r.enlazados} chats quedaron enlazados a ella.`)
      setRecarga((n) => n + 1)
      onPiezaCreada?.()
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'No se pudo crear la pieza')
    } finally {
      setCreando(null)
    }
  }

  if (error) {
    return (
      <p className="rounded-xl border border-red-900/40 bg-red-950/20 px-4 py-2 text-xs text-red-300">
        {error}
      </p>
    )
  }
  if (!codigos || codigos.length === 0) return null

  return (
    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
      <div className="mb-3 flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div>
          <p className="text-sm font-medium text-amber-200">Códigos de ManyChat sin pieza</p>
          <p className="text-xs text-zinc-400">
            Estos chats llegan con un código que no corresponde a ninguna pieza. Se registran como chats del cliente,
            pero no suman a ningún contenido hasta que crees la pieza con ese código.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-2 py-1.5 font-medium">Código</th>
              <th className="px-2 py-1.5 text-right font-medium">Llamadas</th>
              <th className="px-2 py-1.5 text-right font-medium">Personas</th>
              <th className="px-2 py-1.5 font-medium">Primera</th>
              <th className="px-2 py-1.5 font-medium">Última</th>
              <th className="px-2 py-1.5 font-medium">Crear pieza</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {codigos.map((c) => {
              const valido = !/[{}]/.test(c.codigo)
              return (
                <tr key={c.codigo}>
                  <td className="px-2 py-2 font-mono text-zinc-200">{c.codigo}</td>
                  <td className="px-2 py-2 text-right font-mono text-zinc-300">{c.llamadas}</td>
                  <td className="px-2 py-2 text-right font-mono text-zinc-300">{c.personas}</td>
                  <td className="px-2 py-2 text-zinc-400">{fecha(c.primera)}</td>
                  <td className="px-2 py-2 text-zinc-400">
                    {fecha(c.ultima)}
                    {c.pendientes > 0 && (
                      <span className="ml-2 text-[10px] text-amber-400/80" title="Llamadas de antes del arreglo: se registran al correr el reproceso">
                        {c.pendientes} sin registrar
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {valido ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={tipos[c.codigo] ?? tipoSugerido(c.codigo)}
                          onChange={(e) => setTipos((t) => ({ ...t, [c.codigo]: e.target.value as ContentType }))}
                          className="rounded-md border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-zinc-300 focus:outline-none [&>option]:bg-zinc-900"
                        >
                          {TIPOS.map((t) => <option key={t.valor} value={t.valor}>{t.etiqueta}</option>)}
                        </select>
                        <button
                          onClick={() => crear(c.codigo)}
                          disabled={creando !== null}
                          className="flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
                        >
                          {creando === c.codigo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                          Crear
                        </button>
                      </div>
                    ) : (
                      <span className="text-[11px] text-zinc-500" title="ManyChat mandó la variable sin reemplazar">
                        Revisar el flujo en ManyChat
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {aviso && <p className="mt-2 text-xs text-zinc-300">{aviso}</p>}
    </div>
  )
}
