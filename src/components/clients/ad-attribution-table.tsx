import type { AtribucionResult } from '@/lib/actions/ad-attribution'

function formatMoney(value: number, currency: string, decimals = 0): string {
  try {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value)
  } catch {
    return `$${value.toFixed(decimals)}`
  }
}

/** Costo por resultado, o un guion si no hay gasto o no hay resultados. */
function costoPor(spend: number, n: number, currency: string): string {
  if (spend <= 0 || n <= 0) return '–'
  return formatMoney(spend / n, currency)
}

const TH = 'px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-zinc-500'
const TD = 'px-3 py-2 text-xs font-mono text-right text-zinc-300'

/**
 * Personas atribuidas a cada anuncio, agrupadas por campaña. Responde a
 * "de qué anuncio vienen las personas que agendan": por eso las filas se
 * ordenan por agendados y se muestra el costo por agenda al lado del gasto.
 */
export function AdAttributionTable({ atribucion, currency }: { atribucion: AtribucionResult; currency: string }) {
  if (atribucion.status === 'sin_migracion') {
    return (
      <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] px-6 py-8 text-center text-xs text-zinc-500">
        Para atribuir personas a anuncios falta correr la migración 065 en Supabase.
      </div>
    )
  }

  if (atribucion.status === 'sin_datos') {
    return (
      <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] px-6 py-8 text-center text-xs leading-relaxed text-zinc-500">
        Todavía no hay personas atribuidas a un anuncio.
        <br />
        Aparecen aquí cuando el agente crea una persona con el dato del anuncio (referral) desde el que escribió.
      </div>
    )
  }

  const { campanas, totales } = atribucion

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/60">
      <table className="w-full min-w-[820px] border-collapse">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Campaña / anuncio</th>
            <th className={TH}>Gasto</th>
            <th className={TH}>Conversaciones</th>
            <th className={TH}>Calificados</th>
            <th className={TH}>Agendados</th>
            <th className={TH}>Cierres</th>
            <th className={TH}>Costo / agenda</th>
            <th className={`${TH} pr-4`}>Costo / cierre</th>
          </tr>
        </thead>
        <tbody>
          {campanas.map((c) => (
            <CampaignRows key={c.campaignId} campana={c} currency={currency} />
          ))}
          <tr className="border-t border-zinc-700 bg-white/[0.02]">
            <td className="px-4 py-2.5 text-xs font-medium text-zinc-200">Total</td>
            <td className={`${TD} text-zinc-100`}>{formatMoney(totales.spend, currency)}</td>
            <td className={`${TD} text-zinc-100`}>{totales.conversaciones}</td>
            <td className={`${TD} text-zinc-100`}>{totales.calificados}</td>
            <td className={`${TD} text-zinc-100`}>{totales.agendados}</td>
            <td className={`${TD} text-zinc-100`}>{totales.cierres}</td>
            <td className={`${TD} text-zinc-100`}>{costoPor(totales.spend, totales.agendados, currency)}</td>
            <td className={`${TD} pr-4 text-zinc-100`}>{costoPor(totales.spend, totales.cierres, currency)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function CampaignRows({
  campana: c,
  currency,
}: {
  campana: Extract<AtribucionResult, { status: 'success' }>['campanas'][number]
  currency: string
}) {
  return (
    <>
      <tr className="border-b border-white/[0.04] bg-white/[0.015]">
        <td className="px-4 py-2.5">
          <p className="max-w-[320px] truncate text-xs font-medium text-zinc-100" title={c.campaignName}>{c.campaignName}</p>
          <p className="text-[10px] text-zinc-600">{c.ads.length} {c.ads.length === 1 ? 'anuncio' : 'anuncios'}</p>
        </td>
        <td className={`${TD} text-zinc-200`}>{formatMoney(c.spend, currency)}</td>
        <td className={`${TD} text-zinc-200`}>{c.conversaciones}</td>
        <td className={`${TD} text-zinc-200`}>{c.calificados}</td>
        <td className={`${TD} text-emerald-300`}>{c.agendados}</td>
        <td className={`${TD} text-zinc-200`}>{c.cierres}</td>
        <td className={`${TD} text-zinc-200`}>{costoPor(c.spend, c.agendados, currency)}</td>
        <td className={`${TD} pr-4 text-zinc-200`}>{costoPor(c.spend, c.cierres, currency)}</td>
      </tr>
      {c.ads.map((ad) => (
        <tr key={ad.adId} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
          <td className="py-2 pl-8 pr-4">
            <p className="max-w-[300px] truncate text-xs text-zinc-300" title={`${ad.adName} · ${ad.adId}`}>{ad.adName}</p>
            {ad.status && ad.status !== 'ACTIVE' && (
              <span className="text-[10px] text-zinc-600">{ad.status}</span>
            )}
          </td>
          <td className={TD}>{formatMoney(ad.spend, currency)}</td>
          <td className={TD}>{ad.conversaciones}</td>
          <td className={TD}>{ad.calificados}</td>
          <td className={`${TD} text-emerald-400`}>{ad.agendados}</td>
          <td className={TD}>{ad.cierres}</td>
          <td className={TD}>{costoPor(ad.spend, ad.agendados, currency)}</td>
          <td className={`${TD} pr-4`}>{costoPor(ad.spend, ad.cierres, currency)}</td>
        </tr>
      ))}
    </>
  )
}
