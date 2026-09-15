/**
 * Esqueleto de la página del lead.
 *
 * Sin este archivo se heredaría el de la ficha del cliente (pestañas y
 * tarjetas), que no se parece en nada a lo que va a aparecer y hace creer que
 * el clic llevó a otra pantalla.
 */
export default function LeadHistorialLoading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Cargando el historial del lead">
      <div className="h-3 w-32 rounded bg-white/[0.04]" />
      <div className="space-y-3 rounded-2xl border border-white/[0.05] bg-white/[0.025] p-5">
        <div className="h-3 w-24 rounded bg-white/[0.04]" />
        <div className="h-7 w-56 rounded-md bg-white/[0.06]" />
        <div className="h-3 w-72 rounded bg-white/[0.03]" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4 rounded-2xl border border-white/[0.05] bg-white/[0.025] p-5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-10 rounded-lg bg-white/[0.03]" />
          ))}
        </div>
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 rounded-2xl border border-white/[0.05] bg-white/[0.025]" />
          ))}
        </div>
      </div>
    </div>
  )
}
