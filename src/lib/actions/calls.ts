'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { CallOutcome, CallSentiment } from '@/lib/types'

export async function getCalls(leadId?: string) {
  const supabase = await createClient()
  let query = supabase
    .from('sales_calls')
    .select('*, leads(full_name, ig_username, stage, clients(name, ig_handle)), users!sales_calls_caller_id_fkey(full_name)')
    .order('scheduled_at', { ascending: false })

  if (leadId) {
    query = query.eq('lead_id', leadId)
  }

  const { data, error } = await query
  if (error) throw error
  return data
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
  })

  if (error) throw error
  revalidatePath('/calls')
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
