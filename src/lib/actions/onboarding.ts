'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getOnboardingTemplates() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('onboarding_templates')
    .select('*')
    .order('name')

  if (error) throw error
  return data
}

export async function createOnboardingTemplate(formData: FormData) {
  const supabase = await createClient()

  const stepsRaw = formData.get('steps') as string
  let steps = []
  try {
    steps = JSON.parse(stepsRaw)
  } catch {
    steps = stepsRaw.split('\n').filter(Boolean).map((s, i) => ({
      order: i + 1,
      title: s.trim(),
      sop_id: null,
      role: null,
    }))
  }

  const { error } = await supabase.from('onboarding_templates').insert({
    name: formData.get('name') as string,
    steps,
  })

  if (error) throw error
  revalidatePath('/sops')
}

export async function triggerOnboarding(clientId: string, templateId: string) {
  const supabase = await createClient()

  const { data: template } = await supabase
    .from('onboarding_templates')
    .select('*')
    .eq('id', templateId)
    .single()

  if (!template) throw new Error('Template not found')

  const { data: run, error: runError } = await supabase
    .from('onboarding_runs')
    .insert({
      template_id: templateId,
      client_id: clientId,
      status: 'in_progress',
    })
    .select()
    .single()

  if (runError || !run) throw runError || new Error('Failed to create run')

  const steps = (template.steps as Array<{
    order: number
    title: string
    sop_id?: string
    role?: string
  }>) || []

  const tasks = steps.map((step, index) => ({
    run_id: run.id,
    step_index: index,
    title: step.title,
    sop_id: step.sop_id || null,
    assigned_to: null,
    status: 'pending' as const,
  }))

  if (tasks.length > 0) {
    const { error: taskError } = await supabase.from('onboarding_tasks').insert(tasks)
    if (taskError) throw taskError
  }

  revalidatePath(`/clients/${clientId}`)
  return run
}

export async function getOnboardingRuns(clientId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('onboarding_runs')
    .select('*, onboarding_templates(name), onboarding_tasks(*)')
    .eq('client_id', clientId)
    .order('started_at', { ascending: false })

  if (error) throw error
  return data
}

export async function updateOnboardingTaskStatus(taskId: string, status: 'pending' | 'in_progress' | 'completed') {
  const supabase = await createClient()

  const updates: Record<string, unknown> = { status }
  if (status === 'completed') updates.completed_at = new Date().toISOString()

  const { error } = await supabase
    .from('onboarding_tasks')
    .update(updates)
    .eq('id', taskId)

  if (error) throw error
  revalidatePath('/sops')
}
