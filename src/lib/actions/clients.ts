'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getAppUrl } from '@/lib/env'
import type { ClientStatus } from '@/lib/types'

export async function getClients() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getClient(id: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function createClientAction(formData: FormData) {
  const supabase = await createClient()

  const calendlyToken = (formData.get('calendly_token') as string) || null

  const { data: client, error } = await supabase.from('clients').insert({
    name: formData.get('name') as string,
    ig_handle: formData.get('ig_handle') as string,
    ig_account_id: (formData.get('ig_account_id') as string) || null,
    industry: (formData.get('industry') as string) || null,
    status: (formData.get('status') as ClientStatus) || 'prospect',
    monthly_fee: formData.get('monthly_fee')
      ? parseFloat(formData.get('monthly_fee') as string)
      : null,
    calendly_token: calendlyToken,
  }).select('id').single()

  if (error) throw error

  if (calendlyToken && client) {
    await registerCalendlyWebhook(supabase, client.id, calendlyToken)
  }

  revalidatePath('/clients')
}

export async function updateClientAction(id: string, formData: FormData) {
  const supabase = await createClient()

  const calendlyToken = (formData.get('calendly_token') as string) || null

  const { data: existing } = await supabase
    .from('clients')
    .select('calendly_token, calendly_webhook_id')
    .eq('id', id)
    .single()

  const { error } = await supabase
    .from('clients')
    .update({
      name: formData.get('name') as string,
      ig_handle: formData.get('ig_handle') as string,
      ig_account_id: (formData.get('ig_account_id') as string) || null,
      industry: (formData.get('industry') as string) || null,
      status: formData.get('status') as ClientStatus,
      monthly_fee: formData.get('monthly_fee')
        ? parseFloat(formData.get('monthly_fee') as string)
        : null,
      calendly_token: calendlyToken,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw error

  const tokenChanged = calendlyToken && calendlyToken !== existing?.calendly_token
  if (tokenChanged) {
    if (existing?.calendly_webhook_id && existing?.calendly_token) {
      await unregisterCalendlyWebhook(existing.calendly_token, existing.calendly_webhook_id)
    }
    await registerCalendlyWebhook(supabase, id, calendlyToken)
  }

  if (!calendlyToken && existing?.calendly_webhook_id && existing?.calendly_token) {
    await unregisterCalendlyWebhook(existing.calendly_token, existing.calendly_webhook_id)
    await supabase
      .from('clients')
      .update({ calendly_org_uri: null, calendly_webhook_id: null })
      .eq('id', id)
  }

  revalidatePath('/clients')
  revalidatePath(`/clients/${id}`)
}

export async function updateClientAvatars(clientId: string, avatars: string[]) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('clients')
    .update({
      custom_avatars: avatars.filter(Boolean),
      updated_at: new Date().toISOString(),
    })
    .eq('id', clientId)

  if (error) throw error
  revalidatePath(`/clients/${clientId}`)
}

export async function saveAvatarsAction(clientId: string, avatars: string[]) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('clients')
    .update({ custom_avatars: avatars.filter(Boolean) })
    .eq('id', clientId)
  if (error) throw error
}

export async function deleteClientAction(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('clients').delete().eq('id', id)

  if (error) throw error
  revalidatePath('/clients')
}

async function registerCalendlyWebhook(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientId: string,
  token: string
) {
  try {
    const meRes = await fetch('https://api.calendly.com/users/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!meRes.ok) return

    const meData = await meRes.json()
    const orgUri = meData.resource?.current_organization
    if (!orgUri) return

    const appUrl = getAppUrl()
    const callbackUrl = `${appUrl}/api/webhooks/calendly`

    const subRes = await fetch('https://api.calendly.com/webhook_subscriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: callbackUrl,
        events: ['invitee.created', 'invitee.canceled'],
        organization: orgUri,
        scope: 'organization',
      }),
    })

    if (!subRes.ok) {
      const errBody = await subRes.text()
      console.error('[Calendly] Webhook registration failed:', errBody)
      return
    }

    const subData = await subRes.json()
    const webhookId = subData.resource?.uri

    await supabase
      .from('clients')
      .update({
        calendly_org_uri: orgUri,
        calendly_webhook_id: webhookId,
      })
      .eq('id', clientId)

    console.log('[Calendly] Webhook registered for client:', clientId)
  } catch (err) {
    console.error('[Calendly] Registration error:', err)
  }
}

async function unregisterCalendlyWebhook(token: string, webhookUri: string) {
  try {
    await fetch(webhookUri, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {}
}
