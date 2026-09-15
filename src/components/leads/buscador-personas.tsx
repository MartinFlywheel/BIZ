'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Loader2, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LEAD_STAGES } from '@/lib/types'
import { buscarPersonas, type PersonaEncontrada } from '@/lib/actions/leads'

/**
 * Buscador global de leads: nombre, @IG, correo o teléfono.
 *
 * Existe para responder "¿qué pasó con esta persona?" sin saber en qué
 * cliente ni en qué pestaña está. Cada resultado abre la página con su
 * historial completo.
 *
 * Dos formas: `boton` (la barra lateral; abre un panel y responde a Ctrl+K)
 * y `caja` (un campo en línea, para el encabezado de una página). Qué leads
 * aparecen lo decide el servidor con la sesión: admin ve todos los clientes,
 * el resto solo el suyo.
 */

const MINIMO = 2
const ESPERA_MS = 300

const ETIQUETA_ETAPA = Object.fromEntries(LEAD_STAGES.map((s) => [s.id, s.label])) as Record<string, string>

const DONDE_COINCIDE: Record<string, string> = {
  instagram: '@IG',
  nombre: 'nombre',
  correo: 'correo del lead',
  telefono: 'teléfono',
  agenda_nombre: 'nombre en la agenda',
  agenda_correo: 'correo de la agenda',
}

function etiquetaEtapa(stage: string | null): string | null {
  if (!stage) return null
  return ETIQUETA_ETAPA[stage] ?? stage.replace(/_/g, ' ')
}

/** La búsqueda con espera: una consulta por pausa al escribir, no por tecla. */
function useBusqueda(texto: string) {
  const [resultados, setResultados] = useState<PersonaEncontrada[]>([])
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const q = texto.trim()

  useEffect(() => {
    if (q.length < MINIMO) return
    let vigente = true
    const t = setTimeout(async () => {
      setBuscando(true)
      setError(null)
      try {
        const r = await buscarPersonas(q)
        if (vigente) setResultados(r)
      } catch (e) {
        if (vigente) {
          setResultados([])
          setError(e instanceof Error && e.message ? e.message : 'No se pudo buscar')
        }
      } finally {
        if (vigente) setBuscando(false)
      }
    }, ESPERA_MS)
    return () => { vigente = false; clearTimeout(t) }
  }, [q])

  // Derivado, no limpiado desde el efecto: borrar la caja oculta los
  // resultados al instante.
  const activa = q.length >= MINIMO
  return { activa, buscando: activa && buscando, error: activa ? error : null, resultados: activa ? resultados : [] }
}

function ListaResultados({
  estado,
  seleccionado,
  onElegir,
  onResaltar,
}: {
  estado: ReturnType<typeof useBusqueda>
  seleccionado: number
  onElegir: (p: PersonaEncontrada) => void
  onResaltar: (i: number) => void
}) {
  if (!estado.activa) {
    return <p className="px-3 py-3 text-xs text-zinc-600">Escribe al menos {MINIMO} caracteres.</p>
  }
  if (estado.buscando && estado.resultados.length === 0) {
    return (
      <p className="flex items-center gap-2 px-3 py-3 text-xs text-zinc-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando...
      </p>
    )
  }
  if (estado.error) return <p className="px-3 py-3 text-xs text-red-400/90">{estado.error}</p>
  if (estado.resultados.length === 0) {
    return <p className="px-3 py-3 text-xs text-zinc-600">Ningún lead coincide.</p>
  }

  return (
    <ul role="listbox" className="py-1">
      {estado.resultados.map((p, i) => {
        const etapa = etiquetaEtapa(p.stage)
        return (
          <li key={p.leadId} role="option" aria-selected={i === seleccionado}>
            <button
              type="button"
              onMouseEnter={() => onResaltar(i)}
              onClick={() => onElegir(p)}
              className={cn(
                'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors',
                i === seleccionado ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'
              )}
            >
              <span className="flex w-full items-baseline gap-2">
                <span className="truncate text-sm text-zinc-100">
                  {p.nombre || (p.igUsername ? `@${p.igUsername}` : 'Lead sin nombre')}
                </span>
                {p.igUsername && p.nombre && <span className="truncate text-xs text-zinc-500">@{p.igUsername}</span>}
              </span>
              <span className="text-[11px] text-zinc-500">
                {[p.clientName, etapa, `coincide en ${DONDE_COINCIDE[p.coincidencia] ?? p.coincidencia}`].filter(Boolean).join(' · ')}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** Teclado compartido: flechas para moverse, Enter para abrir. */
function useNavegacion(resultados: PersonaEncontrada[], onElegir: (p: PersonaEncontrada) => void) {
  const [seleccionado, setSeleccionado] = useState(0)
  const indice = Math.min(seleccionado, Math.max(resultados.length - 1, 0))

  function onKeyDown(e: React.KeyboardEvent) {
    if (resultados.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSeleccionado((indice + 1) % resultados.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSeleccionado((indice - 1 + resultados.length) % resultados.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const p = resultados[indice]
      if (p) onElegir(p)
    }
  }

  return { seleccionado: indice, setSeleccionado, onKeyDown }
}

function rutaDe(p: PersonaEncontrada): string {
  return `/clients/${p.clientId}/leads/${p.leadId}`
}

const PLACEHOLDER = 'Buscar lead por nombre, @IG, correo o teléfono'

export function BuscadorPersonas({
  variante = 'caja',
  collapsed = false,
  className,
}: {
  variante?: 'caja' | 'boton'
  /** Solo para `boton`: la barra lateral colapsada muestra solo el ícono. */
  collapsed?: boolean
  className?: string
}) {
  return variante === 'boton'
    ? <BotonBuscador collapsed={collapsed} className={className} />
    : <CajaBuscador className={className} />
}

function CajaBuscador({ className }: { className?: string }) {
  const router = useRouter()
  const [texto, setTexto] = useState('')
  const [abierta, setAbierta] = useState(false)
  const contenedor = useRef<HTMLDivElement>(null)
  const estado = useBusqueda(texto)

  function elegir(p: PersonaEncontrada) {
    setAbierta(false)
    setTexto('')
    router.push(rutaDe(p))
  }
  const nav = useNavegacion(estado.resultados, elegir)

  // Clic afuera cierra la lista.
  useEffect(() => {
    if (!abierta) return
    function fuera(e: MouseEvent) {
      if (contenedor.current && !contenedor.current.contains(e.target as Node)) setAbierta(false)
    }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierta])

  return (
    <div ref={contenedor} className={cn('relative w-full sm:w-80', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
      <input
        value={texto}
        onChange={(e) => { setTexto(e.target.value); setAbierta(true) }}
        onFocus={() => setAbierta(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setAbierta(false)
          else nav.onKeyDown(e)
        }}
        placeholder={PLACEHOLDER}
        aria-label={PLACEHOLDER}
        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2 pl-8 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
      />
      {abierta && texto.trim().length > 0 && (
        <div className="absolute right-0 z-30 mt-1 max-h-96 w-full overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl sm:w-[420px]">
          <ListaResultados estado={estado} seleccionado={nav.seleccionado} onElegir={elegir} onResaltar={nav.setSeleccionado} />
        </div>
      )}
    </div>
  )
}

function BotonBuscador({ collapsed, className }: { collapsed: boolean; className?: string }) {
  // Arranca cerrado y solo se abre desde el navegador (clic o atajo), así que
  // cuando se usa createPortal, document ya existe.
  const [abierto, setAbierto] = useState(false)

  // Ctrl+K / Cmd+K desde cualquier pantalla de la agencia.
  useEffect(() => {
    function atajo(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setAbierto(true)
      }
    }
    window.addEventListener('keydown', atajo)
    return () => window.removeEventListener('keydown', atajo)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        title="Buscar lead (Ctrl+K)"
        className={cn(
          'group relative flex h-10 w-10 items-center justify-center rounded-xl text-zinc-500 transition-all duration-300 hover:bg-white/[0.04] hover:text-white/90',
          'sm:h-auto sm:w-full sm:justify-start sm:gap-3 sm:px-3 sm:py-2.5 sm:text-sm sm:font-medium sm:text-zinc-400',
          collapsed && 'sm:justify-center sm:px-0',
          className
        )}
      >
        <Search className="h-[18px] w-[18px] shrink-0" />
        {!collapsed && <span className="hidden sm:inline">Buscar lead</span>}
      </button>
      {abierto && createPortal(<PanelBuscador onClose={() => setAbierto(false)} />, document.body)}
    </>
  )
}

function PanelBuscador({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [texto, setTexto] = useState('')
  const estado = useBusqueda(texto)

  function elegir(p: PersonaEncontrada) {
    onClose()
    router.push(rutaDe(p))
  }
  const nav = useNavegacion(estado.resultados, elegir)

  useEffect(() => {
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previo }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Buscar lead">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-xl overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3">
          <Search className="h-4 w-4 shrink-0 text-zinc-500" />
          <input
            autoFocus
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              else nav.onKeyDown(e)
            }}
            placeholder={PLACEHOLDER}
            aria-label={PLACEHOLDER}
            className="h-12 w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
          {estado.buscando && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-500" />}
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          <ListaResultados estado={estado} seleccionado={nav.seleccionado} onElegir={elegir} onResaltar={nav.setSeleccionado} />
        </div>
        <p className="border-t border-zinc-800 px-3 py-2 text-[11px] text-zinc-600">
          Enter abre el historial del lead · Esc cierra
        </p>
      </div>
    </div>
  )
}
