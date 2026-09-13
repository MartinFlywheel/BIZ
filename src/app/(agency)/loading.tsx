/**
 * Lo que se ve apenas se aprieta un botón de la barra lateral.
 *
 * Sin esto, Next espera a que el servidor termine la página entera antes de
 * cambiar de pantalla, y el clic parece no haber hecho nada. Con un
 * loading.tsx la navegación es inmediata: la barra lateral queda donde está y
 * el contenido muestra este esqueleto mientras llegan los datos.
 */
export default function AgencyLoading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Cargando">
      <div className="space-y-2">
        <div className="h-7 w-48 rounded-md bg-white/[0.06]" />
        <div className="h-3 w-72 rounded bg-white/[0.03]" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 rounded-xl border border-white/[0.05] bg-white/[0.025]" />
        ))}
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 rounded-xl border border-white/[0.04] bg-white/[0.02]" />
        ))}
      </div>
    </div>
  )
}
