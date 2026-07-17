'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export type PipelineStage =
  | 'ideas'
  | 'grabar'
  | 'grabados'
  | 'editados'
  | 'por_publicar'
  | 'publicados'

export interface PipelineItem {
  id: string
  client_id: string
  title: string
  description: string | null
  script: string | null
  reference_url: string | null
  raw_video_url: string | null
  edited_video_url: string | null
  assigned_to: string | null
  due_date: string | null
  angle: string | null
  objective: string | null
  audio_url: string | null
  stage: PipelineStage
  position: number
  created_at: string
}

export async function getPipelineItems(clientId: string): Promise<Record<PipelineStage, PipelineItem[]>> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('content_pipeline')
    .select('*')
    .eq('client_id', clientId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: false })

  if (error) throw error

  const grouped: Record<PipelineStage, PipelineItem[]> = {
    ideas: [], grabar: [], grabados: [], editados: [], por_publicar: [], publicados: [],
  }

  for (const item of data || []) {
    const stage = item.stage as PipelineStage
    if (grouped[stage]) grouped[stage].push(item as PipelineItem)
  }

  return grouped
}

export async function createPipelineItem(clientId: string, title: string, stage: PipelineStage): Promise<PipelineItem> {
  const supabase = await createClient()

  const { data: last } = await supabase
    .from('content_pipeline')
    .select('position')
    .eq('client_id', clientId)
    .eq('stage', stage)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const position = (last?.position ?? -1) + 1

  const { data, error } = await supabase
    .from('content_pipeline')
    .insert({
      client_id: clientId,
      title: title.trim(),
      stage,
      position,
    })
    .select('*')
    .single()

  if (error) throw error
  revalidatePath(`/clients/${clientId}`)
  return data as PipelineItem
}

export async function updatePipelineItem(id: string, clientId: string, fields: {
  title?: string
  description?: string
  script?: string
  reference_url?: string
  raw_video_url?: string
  edited_video_url?: string
  assigned_to?: string
  due_date?: string | null
  angle?: string
  objective?: string
  audio_url?: string | null
  stage?: PipelineStage
  position?: number
}) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('content_pipeline')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw error
  revalidatePath(`/clients/${clientId}`)
}

export async function deletePipelineItem(id: string, clientId: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('content_pipeline')
    .delete()
    .eq('id', id)

  if (error) throw error
  revalidatePath(`/clients/${clientId}`)
}
