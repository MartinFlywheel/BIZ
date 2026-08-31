'use server'

import { createClient } from '@/lib/supabase/server'

const DATE_PRESET = 'last_30d'
const INSIGHT_FIELDS = 'spend,impressions,clicks,ctr,cpc,reach'

interface MetaInsightRow {
  spend?: string
  impressions?: string
  clicks?: string
  ctr?: string
  cpc?: string
  reach?: string
}

interface MetaCampaign {
  id: string
  name: string
  status: string
  objective?: string
  insights?: { data?: MetaInsightRow[] }
}

export interface AdTotals {
  spend: number
  impressions: number
  clicks: number
  ctr: number
  cpc: number
  reach: number
}

export interface AdCampaign extends AdTotals {
  id: string
  name: string
  status: string
  objective: string | null
}

export interface ClientAdsData {
  accountName: string
  currency: string
  totals: AdTotals
  campaigns: AdCampaign[]
}

export type ClientAdsResult =
  | { status: 'not_connected' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: ClientAdsData }

function toTotals(row: MetaInsightRow | undefined): AdTotals {
  return {
    spend: Number(row?.spend) || 0,
    impressions: Number(row?.impressions) || 0,
    clicks: Number(row?.clicks) || 0,
    ctr: Number(row?.ctr) || 0,
    cpc: Number(row?.cpc) || 0,
    reach: Number(row?.reach) || 0,
  }
}

// Meta Marketing API — same System User Token as the Instagram content sync
// (src/lib/actions/instagram.ts), which already carries ads_management/
// ads_read scope. Account-level totals and per-campaign insights are fetched
// in parallel; campaign insights come back nested via field expansion
// (one call instead of one-per-campaign).
export async function getClientAdsData(clientId: string): Promise<ClientAdsResult> {
  const supabase = await createClient()
  const { data: client } = await supabase
    .from('clients')
    .select('ad_account_id')
    .eq('id', clientId)
    .single()

  if (!client?.ad_account_id) return { status: 'not_connected' }

  const token = process.env.META_SYSTEM_USER_TOKEN
  if (!token) return { status: 'error', message: 'META_SYSTEM_USER_TOKEN no configurado' }

  const adAccountId = client.ad_account_id

  try {
    const [accountRes, totalsRes, campaignsRes] = await Promise.all([
      fetch(`https://graph.facebook.com/v21.0/${adAccountId}?fields=name,currency&access_token=${token}`),
      fetch(`https://graph.facebook.com/v21.0/${adAccountId}/insights?fields=${INSIGHT_FIELDS}&date_preset=${DATE_PRESET}&access_token=${token}`),
      fetch(`https://graph.facebook.com/v21.0/${adAccountId}/campaigns?fields=name,status,objective,insights.date_preset(${DATE_PRESET}){${INSIGHT_FIELDS}}&limit=50&access_token=${token}`),
    ])

    if (!accountRes.ok) {
      const body = await accountRes.text()
      return { status: 'error', message: `No se pudo leer la cuenta publicitaria: ${body.slice(0, 300)}` }
    }

    const account: { name?: string; currency?: string } = await accountRes.json()
    const totalsData: { data?: MetaInsightRow[] } = totalsRes.ok ? await totalsRes.json() : {}
    const campaignsData: { data?: MetaCampaign[] } = campaignsRes.ok ? await campaignsRes.json() : {}

    const campaigns: AdCampaign[] = (campaignsData.data || [])
      .map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        objective: c.objective || null,
        ...toTotals(c.insights?.data?.[0]),
      }))
      .sort((a, b) => b.spend - a.spend)

    return {
      status: 'success',
      data: {
        accountName: account.name || 'Cuenta publicitaria',
        currency: account.currency || 'USD',
        totals: toTotals(totalsData.data?.[0]),
        campaigns,
      },
    }
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Error desconocido' }
  }
}
