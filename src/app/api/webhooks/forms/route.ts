import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Google Forms has no native webhook — this expects Zapier/Make relaying a
// submission as JSON: { email, phone, photos: [url, ...], ...otherAnswers }.
// Configure the Zap/scenario to POST to:
//   /api/webhooks/forms?client_id=<uuid>&token=<PAYMENTS_WEBHOOK_TOKEN>
// `email` or `phone` must match the student created by the payments webhook.

export async function POST(request: Request) {
  const supabase = createAdminClient()
  const url = new URL(request.url)
  const clientId = url.searchParams.get('client_id')
  const token = url.searchParams.get('token')

  if (!process.env.PAYMENTS_WEBHOOK_TOKEN || token !== process.env.PAYMENTS_WEBHOOK_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let webhookLogId: string | null = null

  try {
    const body = await request.json()

    const { data: logRow } = await supabase
      .from('webhook_logs')
      .insert({ source: 'forms', event_type: 'onboarding_submission', payload: body, processed: false })
      .select('id')
      .single()
    webhookLogId = logRow?.id || null

    if (!clientId) {
      await markLog(supabase, webhookLogId, 'Missing client_id query param on webhook URL')
      return NextResponse.json({ error: 'Missing client_id' }, { status: 400 })
    }

    const email: string | null = body.email?.trim().toLowerCase() || null
    const phone: string | null = body.phone?.trim() || null
    const photos: string[] = Array.isArray(body.photos) ? body.photos : []
    const { email: _e, phone: _p, photos: _ph, ...formResponses } = body

    if (!email && !phone) {
      await markLog(supabase, webhookLogId, 'Submission has neither email nor phone')
      return NextResponse.json({ error: 'Missing email/phone' }, { status: 400 })
    }

    let query = supabase.from('program_students').select('id').eq('client_id', clientId)
    query = email ? query.eq('email', email) : query.eq('phone', phone!)
    const { data: student } = await query.maybeSingle()

    if (!student) {
      await markLog(supabase, webhookLogId, `No student matched for email="${email}" phone="${phone}"`)
      return NextResponse.json({ received: true, warning: 'No student matched — logged for manual review' })
    }

    const { error: insertError } = await supabase.from('onboarding_data').insert({
      student_id: student.id,
      form_responses: formResponses,
      photos,
    })

    if (insertError) {
      await markLog(supabase, webhookLogId, `onboarding_data insert failed: ${insertError.message}`)
      return NextResponse.json({ error: 'Failed to save onboarding data' }, { status: 500 })
    }

    await markLog(supabase, webhookLogId, null)
    return NextResponse.json({ received: true, student_id: student.id })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Forms] Fatal error:', msg)
    await markLog(supabase, webhookLogId, msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function markLog(
  supabase: ReturnType<typeof createAdminClient>,
  logId: string | null,
  error: string | null
) {
  if (!logId) return
  await supabase.from('webhook_logs').update({ processed: true, error }).eq('id', logId)
}
