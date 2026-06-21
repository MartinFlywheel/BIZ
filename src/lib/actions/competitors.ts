'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Competitor, CompetitorReel } from '@/lib/types'

export async function getCompetitors(clientId: string): Promise<Competitor[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('competitors')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function getCompetitorReelsByClient(clientId: string): Promise<Record<string, CompetitorReel[]>> {
  const { unstable_noStore } = await import('next/cache')
  unstable_noStore()

  const supabase = await createClient()

  const { data: competitors } = await supabase
    .from('competitors')
    .select('id')
    .eq('client_id', clientId)

  if (!competitors || competitors.length === 0) return {}

  const ids = competitors.map((c) => c.id)

  const { data: reels, error } = await supabase
    .from('competitor_reels')
    .select('*')
    .in('competitor_id', ids)
    .order('published_at', { ascending: false })

  console.log('[Competitors] Reels fetched:', ids.length, 'competitors,', reels?.length ?? 0, 'reels', error ? `ERROR: ${error.message}` : '')

  const grouped: Record<string, CompetitorReel[]> = {}
  for (const reel of reels || []) {
    if (!grouped[reel.competitor_id]) grouped[reel.competitor_id] = []
    grouped[reel.competitor_id].push(reel)
  }

  return grouped
}

export async function getCompetitorWithReels(
  competitorId: string
): Promise<{ competitor: Competitor; reels: CompetitorReel[] } | null> {
  const supabase = await createClient()

  const { data: competitor, error: compError } = await supabase
    .from('competitors')
    .select('*')
    .eq('id', competitorId)
    .single()

  if (compError || !competitor) return null

  const { data: reels } = await supabase
    .from('competitor_reels')
    .select('*')
    .eq('competitor_id', competitorId)
    .order('published_at', { ascending: false })

  return { competitor, reels: reels ?? [] }
}

export async function createCompetitorAction(formData: FormData) {
  const supabase = await createClient()
  const clientId = formData.get('client_id') as string
  const igHandle = (formData.get('ig_handle') as string) || null

  const { data: competitor, error } = await supabase.from('competitors').insert({
    client_id: clientId,
    name: formData.get('name') as string,
    ig_handle: igHandle,
    analisis_estrategico: (formData.get('analisis_estrategico') as string) || null,
  }).select('id').single()

  if (error) throw error

  if (igHandle && competitor) {
    triggerN8nSync(competitor.id, igHandle).catch((err) =>
      console.error('[Competitor] n8n trigger failed:', err)
    )
  }

  revalidatePath(`/clients/${clientId}`)
}

async function triggerN8nSync(competitorId: string, igHandle: string) {
  const n8nUrl = process.env.N8N_COMPETITOR_SYNC_URL
  if (!n8nUrl) {
    console.log('[Competitor] N8N_COMPETITOR_SYNC_URL not configured, skipping auto-sync')
    return
  }

  await fetch(n8nUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      competitor_id: competitorId,
      ig_handle: igHandle,
      instagram_profile_url: `https://www.instagram.com/${igHandle.replace(/^@/, '')}/`,
    }),
  })
}

export async function updateCompetitorAction(id: string, formData: FormData) {
  const supabase = await createClient()
  const clientId = formData.get('client_id') as string

  const { error } = await supabase
    .from('competitors')
    .update({
      name: formData.get('name') as string,
      ig_handle: (formData.get('ig_handle') as string) || null,
      analisis_estrategico: (formData.get('analisis_estrategico') as string) || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw error
  revalidatePath(`/clients/${clientId}`)
}

export async function updateCompetitorAnalysis(
  id: string,
  field: 'oferta' | 'avatar_target' | 'conclusion',
  value: string
) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('competitors')
    .update({
      [field]: value || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw error
}

export async function deleteCompetitorAction(id: string, clientId: string) {
  const supabase = await createClient()

  // Delete reels first (FK constraint)
  await supabase.from('competitor_reels').delete().eq('competitor_id', id)

  const { error } = await supabase.from('competitors').delete().eq('id', id)
  if (error) throw error

  revalidatePath(`/clients/${clientId}`)
}
