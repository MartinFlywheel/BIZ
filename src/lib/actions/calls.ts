'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { CallOutcome, CallSentiment, CallBucket, CallFolder } from '@/lib/types'
import { fetchAllRows } from '@/lib/supabase/paginate'

export async function getCalls(leadId?: string) {
  const supabase = await createClient()

  return fetchAllRows((from, to) => {
    let query = supabase
      .from('sales_calls')
      .select('*, leads(full_name, ig_username, stage, clients(name, ig_handle)), users!sales_calls_caller_id_fkey(full_name)')
      .order('scheduled_at', { ascending: false })
      .range(from, to)

    if (leadId) query = query.eq('lead_id', leadId)
    return query
  })
}

export async function getCallFolders(clientId: string): Promise<CallFolder[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('call_folders')
    .select('*')
    .eq('client_id', clientId)
    .order('name', { ascending: true })

  if (error) throw error
  return (data ?? []) as CallFolder[]
}

export async function createCallFolder(
  clientId: string,
  bucket: CallBucket,
  name: string,
  parentId: string | null
): Promise<CallFolder> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('call_folders')
    .insert({ client_id: clientId, bucket, name: name.trim(), parent_id: parentId })
    .select()
    .single()

  if (error) throw error
  revalidatePath(`/clients/${clientId}`)
  return data as CallFolder
}

export async function renameCallFolder(id: string, name: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('call_folders')
    .update({ name: name.trim() })
    .eq('id', id)
    .select('client_id')
    .single()
  if (error) throw error
  revalidatePath(`/clients/${data.client_id}`)
}

export async function deleteCallFolder(id: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('call_folders')
    .delete()
    .eq('id', id)
    .select('client_id')
    .single()
  if (error) throw error
  revalidatePath(`/clients/${data.client_id}`)
}

export async function moveCall(callId: string, bucket: CallBucket, folderId: string | null) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sales_calls')
    .update({ bucket, folder_id: folderId })
    .eq('id', callId)
    .select('lead_id, leads(client_id)')
    .single()

  if (error) throw error
  const clientId = (data.leads as unknown as { client_id: string } | null)?.client_id
  if (clientId) revalidatePath(`/clients/${clientId}`)
}

export async function createCallAction(formData: FormData) {
  const supabase = await createClient()

  const { error } = await supabase.from('sales_calls').insert({
    lead_id: formData.get('lead_id') as string,
    caller_id: (formData.get('caller_id') as string) || null,
    scheduled_at: (formData.get('scheduled_at') as string) || null,
    outcome: (formData.get('outcome') as CallOutcome) || null,
    transcript: (formData.get('transcript') as string) || null,
    ai_summary: (formData.get('ai_summary') as string) || null,
    next_steps: (formData.get('next_steps') as string) || null,
    sentiment: (formData.get('sentiment') as CallSentiment) || null,
    fathom_recording_id: (formData.get('fathom_recording_id') as string) || null,
    fathom_call_url: (formData.get('fathom_call_url') as string) || null,
    bucket: (formData.get('bucket') as CallBucket) || 'no_cerrada',
    folder_id: (formData.get('folder_id') as string) || null,
  })

  if (error) throw error
  revalidatePath('/calls')
  const clientId = formData.get('client_id') as string
  if (clientId) revalidatePath(`/clients/${clientId}`)
}

export async function updateCallAction(id: string, formData: FormData) {
  const supabase = await createClient()

  const objectionsRaw = formData.get('objections') as string
  let objections = []
  if (objectionsRaw) {
    try {
      objections = JSON.parse(objectionsRaw)
    } catch {
      objections = objectionsRaw.split('\n').filter(Boolean).map((o) => ({
        objection: o.trim(),
        response: '',
        resolved: false,
      }))
    }
  }

  const { error } = await supabase
    .from('sales_calls')
    .update({
      outcome: (formData.get('outcome') as CallOutcome) || null,
      transcript: (formData.get('transcript') as string) || null,
      ai_summary: (formData.get('ai_summary') as string) || null,
      objections,
      next_steps: (formData.get('next_steps') as string) || null,
      sentiment: (formData.get('sentiment') as CallSentiment) || null,
      started_at: (formData.get('started_at') as string) || null,
      ended_at: (formData.get('ended_at') as string) || null,
      duration_seconds: formData.get('duration_seconds')
        ? parseInt(formData.get('duration_seconds') as string)
        : null,
    })
    .eq('id', id)

  if (error) throw error
  revalidatePath('/calls')
}

export async function updateCallFathomUrl(callId: string, fathomUrl: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('sales_calls')
    .update({ fathom_call_url: fathomUrl || null })
    .eq('id', callId)

  if (error) throw error
  revalidatePath('/calls')
}
