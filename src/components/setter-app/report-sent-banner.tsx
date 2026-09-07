'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'

/**
 * Confirmación de "Reporte enviado" al volver a la lista de leads.
 *
 * El texto del botón ya cambia al enviar, pero esa pantalla desaparece con la
 * navegación: la setter terminaba en sus leads sin ninguna señal de que el
 * reporte había quedado guardado. Una lo leyó como que se había colgado y lo
 * envió dos veces. El aviso vive acá, del otro lado del redirect, que es donde
 * ella efectivamente está mirando cuando termina el proceso.
 *
 * Se limpia solo: a los 6 segundos se oculta y saca `?reporte=enviado` de la
 * URL, para que recargar o compartir el enlace no lo muestre de nuevo. El
 * replace conserva el resto de los parámetros (`?client=` del admin).
 */
export function ReportSentBanner() {
  const [visible, setVisible] = useState(true)
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(false)
      const params = new URLSearchParams(searchParams.toString())
      params.delete('reporte')
      const qs = params.toString()
      router.replace(qs ? `/setter-app?${qs}` : '/setter-app', { scroll: false })
    }, 6000)
    return () => clearTimeout(t)
  }, [router, searchParams])

  if (!visible) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-4 mb-4 flex items-center gap-2.5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3"
    >
      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
      <div>
        <p className="text-sm font-medium text-emerald-300">Reporte enviado</p>
        <p className="text-xs text-emerald-400/70">Tu ciclo se reinició. No hace falta enviarlo de nuevo.</p>
      </div>
    </div>
  )
}
