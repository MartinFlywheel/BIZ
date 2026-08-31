'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getAppUrl } from '@/lib/env'
import type { ClientStatus, PipelineStageConfig } from '@/lib/types'

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

// Client record mutations (create/update/delete) are agency-strategy actions
// — same admin-only bar as team management, since delete cascades a
// client's entire history and none of it was gated server-side before.
async function assertAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user: currentUser } } = await supabase.auth.getUser()
  if (!currentUser) throw new Error('No autenticado')

  const { data: caller } = await supabase
    .from('users')
    .select('role, user_type')
    .eq('id', currentUser.id)
    .single()

  if (!caller || caller.user_type !== 'agency' || caller.role !== 'admin') {
    throw new Error('Solo un admin puede realizar esta acción')
  }
}

// Instagram sync (syncClientContent, both cron jobs) loops every client
// with an ig_account_id and pulls that account's media into content_pieces
// scoped to that client's client_id. A copy-paste mistake landing the same
// ig_account_id on two clients would sync one Instagram account's content
// into both clients' dashboards.
async function assertIgAccountIdAvailable(
  supabase: Awaited<ReturnType<typeof createClient>>,
  igAccountId: string | null,
  excludeId?: string
): Promise<void> {
  if (!igAccountId) return

  let query = supabase.from('clients').select('id, name').eq('ig_account_id', igAccountId).limit(1)
  if (excludeId) query = query.neq('id', excludeId)

  const { data: clash } = await query.maybeSingle()
  if (clash) {
    throw new Error(`Ese Instagram Account ID ya está en uso por "${clash.name}" — cada cliente necesita el suyo propio.`)
  }
}

export async function createClientAction(formData: FormData): Promise<{ calendlyError: string | null }> {
  const supabase = await createClient()
  await assertAdmin(supabase)

  const calendlyToken = (formData.get('calendly_token') as string) || null
  const igAccountId = (formData.get('ig_account_id') as string) || null
  await assertIgAccountIdAvailable(supabase, igAccountId)

  const { data: client, error } = await supabase.from('clients').insert({
    name: formData.get('name') as string,
    ig_handle: formData.get('ig_handle') as string,
    ig_account_id: igAccountId,
    industry: (formData.get('industry') as string) || null,
    status: (formData.get('status') as ClientStatus) || 'prospect',
    monthly_fee: formData.get('monthly_fee')
      ? parseFloat(formData.get('monthly_fee') as string)
      : null,
    calendly_token: calendlyToken,
  }).select('id').single()

  if (error) throw error

  let calendlyError: string | null = null
  if (calendlyToken && client) {
    calendlyError = await registerCalendlyWebhook(supabase, client.id, calendlyToken)
  }

  revalidatePath('/clients')
  return { calendlyError }
}

export async function updateClientAction(id: string, formData: FormData): Promise<{ calendlyError: string | null }> {
  const supabase = await createClient()
  await assertAdmin(supabase)

  const calendlyToken = (formData.get('calendly_token') as string) || null
  const igAccountId = (formData.get('ig_account_id') as string) || null
  await assertIgAccountIdAvailable(supabase, igAccountId, id)

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
      ig_account_id: igAccountId,
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

  let calendlyError: string | null = null

  const tokenChanged = calendlyToken && calendlyToken !== existing?.calendly_token
  if (tokenChanged) {
    if (existing?.calendly_webhook_id && existing?.calendly_token) {
      await unregisterCalendlyWebhook(existing.calendly_token, existing.calendly_webhook_id)
    }
    calendlyError = await registerCalendlyWebhook(supabase, id, calendlyToken)
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
  return { calendlyError }
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

export async function saveAvatarsAction(
  clientId: string,
  avatars: string[]
): Promise<{ success: true } | { success: false; error: string }> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('clients')
    .update({ custom_avatars: avatars.filter(Boolean) })
    .eq('id', clientId)
  if (error) return { success: false, error: error.message }
  return { success: true }
}

export async function deleteClientAction(id: string) {
  const supabase = await createClient()
  await assertAdmin(supabase)
  const { error } = await supabase.from('clients').delete().eq('id', id)

  if (error) throw error
  revalidatePath('/clients')
}

// Returns null on success, or a user-facing error message on failure — the
// client record itself still saves either way, but the caller surfaces this
// so a bad/expired token doesn't fail silently (previously only logged
// server-side, so a client could go weeks with zero Calendly data and no
// one would know why).
async function registerCalendlyWebhook(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientId: string,
  token: string
): Promise<string | null> {
  try {
    const meRes = await fetch('https://api.calendly.com/users/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!meRes.ok) {
      return `Calendly rechazó el token (HTTP ${meRes.status}). Verificá que esté copiado completo desde calendly.com/integrations/api_webhooks y no haya expirado.`
    }

    const meData = await meRes.json()
    const orgUri = meData.resource?.current_organization
    if (!orgUri) {
      return 'El token es válido pero Calendly no devolvió una organización asociada a la cuenta.'
    }

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
      return `Calendly rechazó la suscripción al webhook: ${errBody.slice(0, 200)}`
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
    return null
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido'
    console.error('[Calendly] Registration error:', err)
    return `Error de red al conectar con Calendly: ${msg}`
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

export async function updateClientPipelineStagesAction(clientId: string, stages: PipelineStageConfig[]) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('clients')
    .update({ pipeline_stages: stages, updated_at: new Date().toISOString() })
    .eq('id', clientId)

  if (error) throw error

  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/dashboard')
  revalidatePath('/leads')
}
