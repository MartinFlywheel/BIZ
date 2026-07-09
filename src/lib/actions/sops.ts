'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getSops(filterTag?: string) {
  const supabase = await createClient()
  let query = supabase
    .from('sops')
    .select('*')
    .eq('is_active', true)
    .order('title')

  if (filterTag) {
    query = query.contains('tags', [filterTag])
  }

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function getSop(id: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sops')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function createSopAction(formData: FormData) {
  const supabase = await createClient()

  const tagsRaw = formData.get('tags') as string
  const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : []
  const attachmentsRaw = formData.get('attachments') as string
  const attachments = attachmentsRaw ? JSON.parse(attachmentsRaw) : []

  const { error } = await supabase.from('sops').insert({
    title: formData.get('title') as string,
    content: (formData.get('content') as string) || '',
    category: (formData.get('category') as string) || null,
    tags,
    attachments,
  })

  if (error) throw error
  revalidatePath('/sops')
}

export async function updateSopAction(id: string, formData: FormData) {
  const supabase = await createClient()

  const tagsRaw = formData.get('tags') as string
  const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : []
  const attachmentsRaw = formData.get('attachments') as string
  const attachments = attachmentsRaw ? JSON.parse(attachmentsRaw) : []

  const { error } = await supabase
    .from('sops')
    .update({
      title: formData.get('title') as string,
      content: (formData.get('content') as string) || '',
      category: (formData.get('category') as string) || null,
      tags,
      attachments,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw error
  revalidatePath('/sops')
}

export async function deleteSopAction(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('sops').delete().eq('id', id)

  if (error) throw error
  revalidatePath('/sops')
}
