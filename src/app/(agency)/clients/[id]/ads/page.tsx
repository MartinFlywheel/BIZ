import Link from 'next/link'
import { notFound } from 'next/navigation'
import { unstable_noStore } from 'next/cache'
import { ArrowLeft, Megaphone, AlertTriangle } from 'lucide-react'
import { getClient } from '@/lib/actions/clients'
import { getClientAdsData, type AdCampaign } from '@/lib/actions/ads'
import { MetricCard } from '@/components/dashboard/metric-card'
import { formatNumber, formatPercent } from '@/lib/utils'

function formatMoney(value: number, currency: string, decimals = 0): string {
  try {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value)
  } catch {
    return `$${value.toFixed(decimals)}`
  }
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  PAUSED: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25',
  ARCHIVED: 'bg-zinc-500/15 text-zinc-500 border-zinc-500/25',
  DELETED: 'bg-red-500/15 text-red-400 border-red-500/25',
}

function CampaignsTable({ campaigns, currency }: { campaigns: AdCampaign[]; currency: string }) {
  if (campaigns.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 py-10 text-center text-sm text-zinc-500">
        Sin campañas en los últimos 30 días.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/60">
      <table className="w-full min-w-[720px] border-collapse">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Campaña</th>
            <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Gasto</th>
            <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Impresiones</th>
            <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Clics</th>
            <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-zinc-500">CTR</th>
            <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-zinc-500">CPC</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => (
            <tr key={c.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
              <td className="px-4 py-2.5">
                <p className="text-xs text-zinc-200 max-w-[280px] truncate" title={c.name}>{c.name}</p>
                <span className={`mt-1 inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[c.status] || STATUS_STYLE.PAUSED}`}>
                  {c.status}
                </span>
              </td>
              <td className="px-3 py-2.5 text-xs font-mono text-right text-zinc-300">{formatMoney(c.spend, currency, 2)}</td>
              <td className="px-3 py-2.5 text-xs font-mono text-right text-zinc-300">{formatNumber(c.impressions)}</td>
              <td className="px-3 py-2.5 text-xs font-mono text-right text-zinc-300">{formatNumber(c.clicks)}</td>
              <td className="px-3 py-2.5 text-xs font-mono text-right text-zinc-300">{formatPercent(c.ctr)}</td>
              <td className="px-4 py-2.5 text-xs font-mono text-right text-zinc-300">{formatMoney(c.cpc, currency, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default async function ClientAdsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  unstable_noStore()

  const client = await getClient(id).catch(() => null)
  if (!client) notFound()

  const ads = await getClientAdsData(id)

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

      {ads.status === 'not_connected' && (
        <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] px-6 py-16 text-center">
          <Megaphone className="mx-auto mb-3 h-8 w-8 text-zinc-700" />
          <p className="text-sm font-medium text-zinc-300">Este cliente todavía no tiene una cuenta publicitaria conectada</p>
          <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-zinc-600">
            Carga el Meta Ad Account ID desde Editar cliente para ver aquí el gasto, campañas y rendimiento.
          </p>
        </div>
      )}

      {ads.status === 'error' && (
        <div className="flex items-start gap-3 rounded-xl border border-red-900/50 bg-red-950/20 px-4 py-3 text-sm text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <p>{ads.message}</p>
        </div>
      )}

      {ads.status === 'success' && (
        <div className="space-y-6">
          <p className="text-xs text-zinc-500">{ads.data.accountName} · últimos 30 días</p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5 2xl:gap-6">
            <MetricCard title="Gasto" value={formatMoney(ads.data.totals.spend, ads.data.currency)} />
            <MetricCard title="Alcance" value={formatNumber(ads.data.totals.reach)} />
            <MetricCard title="Impresiones" value={formatNumber(ads.data.totals.impressions)} />
            <MetricCard title="CTR" value={formatPercent(ads.data.totals.ctr)} />
            <MetricCard title="CPC" value={formatMoney(ads.data.totals.cpc, ads.data.currency, 2)} />
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-medium text-white/90">Campañas</h2>
            <CampaignsTable campaigns={ads.data.campaigns} currency={ads.data.currency} />
          </div>
        </div>
      )}
    </div>
  )
}
