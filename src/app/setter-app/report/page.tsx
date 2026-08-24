import { redirect } from 'next/navigation'
import { getSetterContext, getCycleProgress } from '@/lib/actions/setter-app'
import { ReportForm } from '@/components/setter-app/report-form'

export default async function SetterReportPage() {
  const context = await getSetterContext()

  if (!context) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center text-sm text-zinc-500">
        No se pudo cargar tu sesión. Vuelve a iniciar sesión.
      </div>
    )
  }

  // Admins have no personal quota — nothing to report, nowhere to send them.
  if (context.isAdmin || !context.clientId) redirect('/setter-app')

  const progress = await getCycleProgress(context.userId, context.clientId)

  // Landed here directly without actually crossing the quota (e.g. typed
  // the URL) — nothing to submit yet, send back to work.
  if (!progress.needsReport) redirect('/setter-app')

  return (
    <div className="flex min-h-screen flex-col justify-center px-4 py-10">
      <div className="mb-6 text-center">
        <p className="text-4xl">🎯</p>
        <h1 className="mt-3 text-xl font-semibold text-white">¡Completaste tu ciclo!</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Completa el reporte para seguir usando la app.
        </p>
      </div>
      <ReportForm userId={context.userId} clientId={context.clientId} progress={progress} />
    </div>
  )
}
