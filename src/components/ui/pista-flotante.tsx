'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface Pista {
  texto: string
  x: number
  y: number
}

/**
 * Resumen que aparece al dejar el mouse sobre una pestaña.
 *
 * Se dibuja con position: fixed y no dentro del botón: la barra de pestañas
 * tiene scroll horizontal (overflow-x-auto), y cualquier cosa absoluta dentro
 * de ella quedaba recortada. Aparece tras una pausa corta para no parpadear al
 * cruzar la barra con el mouse, y no se usa en pantallas táctiles (no hay
 * hover; el toque abre la pestaña directamente).
 *
 * Uso: `const { props, pista } = usePistaFlotante()`, luego
 * `<button {...props('texto')}>` y `{pista}` en cualquier lugar del árbol.
 */
export function usePistaFlotante() {
  const [pista, setPista] = useState<Pista | null>(null)
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null)

  const ocultar = useCallback(() => {
    if (espera.current) clearTimeout(espera.current)
    espera.current = null
    setPista(null)
  }, [])

  useEffect(() => {
    // Un scroll deja la pista flotando lejos de su pestaña.
    window.addEventListener('scroll', ocultar, true)
    return () => {
      window.removeEventListener('scroll', ocultar, true)
      if (espera.current) clearTimeout(espera.current)
    }
  }, [ocultar])

  const props = useCallback((texto: string | undefined) => {
    if (!texto) return {}
    return {
      onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
        if (e.pointerType !== 'mouse') return
        const rect = e.currentTarget.getBoundingClientRect()
        if (espera.current) clearTimeout(espera.current)
        espera.current = setTimeout(() => {
          const ancho = 280
          const x = Math.max(8, Math.min(rect.left + rect.width / 2 - ancho / 2, window.innerWidth - ancho - 8))
          setPista({ texto, x, y: rect.bottom + 8 })
        }, 350)
      },
      onPointerLeave: ocultar,
      onPointerDown: ocultar,
    }
  }, [ocultar])

  const elemento = pista ? (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[100] w-[280px] rounded-lg border border-white/[0.1] bg-[#18181b]/95 px-3 py-2 text-xs leading-relaxed text-zinc-300 shadow-2xl backdrop-blur-xl"
      style={{ left: pista.x, top: pista.y }}
    >
      {pista.texto}
    </div>
  ) : null

  return { props, pista: elemento }
}
