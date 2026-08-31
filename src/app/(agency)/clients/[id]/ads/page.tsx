import Link from 'next/link'
import { notFound } from 'next/navigation'
import { unstable_noStore } from 'next/cache'
import { ArrowLeft, Megaphone } from 'lucide-react'
import { getClient } from '@/lib/actions/clients'

// Its own route (not a tab on the client page) so it ships zero extra JS/data
// to the main CRM view — it only loads when someone actually navigates here.
export default async function ClientAdsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  unstable_noStore()

  const client = await getClient(id).catch(() => null)
  if (!client) notFound()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 border-b border-zinc-800 pb-4">
        <Link
          href={`/clients/${id}`}
          className="rounded-lg p-2 text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.04]">
          <Megaphone className="h-4.5 w-4.5 text-zinc-400" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-zinc-100">Ads</p>
          <p className="truncate text-xs text-zinc-500">{client.name}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] px-6 py-16 text-center">
        <Megaphone className="mx-auto mb-3 h-8 w-8 text-zinc-700" />
        <p className="text-sm font-medium text-zinc-300">Todavía no hay datos de Ads conectados</p>
        <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-zinc-600">
          Cuando se conecte la cuenta publicitaria de Meta de este cliente, acá van a aparecer gasto, campañas y rendimiento.
        </p>
      </div>
    </div>
  )
}
