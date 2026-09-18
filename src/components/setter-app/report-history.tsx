import { FileText } from 'lucide-react'
import type { DailyReportRow } from '@/lib/actions/setter-app'

const fecha = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago',
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

/**
 * Los reportes de cierre de ciclo ya enviados.
 *
 * Una setter pidió poder releer lo que mandó: el formulario desaparece al
 * enviarlo y no quedaba forma de ver qué objeciones o comentarios había
 * escrito. Cada reporte va en un <details> para que la lista sea corta y se
 * abra sin JavaScript. `mostrarNombre` es para la vista de equipo del admin.
 */
export function ReportHistory({
  reportes,
  titulo,
  mostrarNombre = false,
}: {
  reportes: DailyReportRow[]
  titulo: string
  mostrarNombre?: boolean
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
      <p className="mb-3 text-sm font-medium text-zinc-300">{titulo}</p>

      {reportes.length === 0 ? (
        <p className="text-xs text-zinc-600">Todavía no hay reportes enviados.</p>
      ) : (
        <div className="space-y-2">
          {reportes.map((r) => (
            <details key={r.id} className="group rounded-xl border border-white/[0.06] bg-white/[0.02]">
              <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2.5">
                <FileText className="h-4 w-4 shrink-0 text-zinc-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium capitalize text-zinc-200">
                    {mostrarNombre && r.setterName ? `${r.setterName} · ` : ''}
                    {fecha.format(new Date(r.submittedAt))}
                  </p>
                  <p className="font-mono text-[11px] text-zinc-500">
                    {r.leadsTouched} leads · {r.agendasSet} agendas · {r.followupsTotal} seguim.
                  </p>
                </div>
                <span className="text-xs text-zinc-600 transition-transform group-open:rotate-90">›</span>
              </summary>
              <div className="space-y-3 border-t border-white/[0.06] px-3 py-3 text-xs">
                <div>
                  <p className="mb-1 text-[11px] uppercase tracking-wider text-zinc-600">Objeciones</p>
                  <p className="whitespace-pre-wrap text-zinc-300">{r.commonObjections || '—'}</p>
                </div>
                <div>
                  <p className="mb-1 text-[11px] uppercase tracking-wider text-zinc-600">Comentarios para marketing</p>
                  <p className="whitespace-pre-wrap text-zinc-300">{r.marketingFeedback || '—'}</p>
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}
