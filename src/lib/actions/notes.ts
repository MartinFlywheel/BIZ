'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getContentNotes(contentId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('content_notes')
    .select('*, users!content_notes_author_id_fkey(full_name)')
    .eq('content_id', contentId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function createNoteAction(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const tagsRaw = formData.get('tags') as string
  const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : []

  const { error } = await supabase.from('content_notes').insert({
    content_id: formData.get('content_id') as string,
    author_id: user.id,
    note: formData.get('note') as string,
    tags,
  })

  if (error) throw error
  revalidatePath('/content')
}

export async function deleteNoteAction(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('content_notes').delete().eq('id', id)

  if (error) throw error
  revalidatePath('/content')
}
