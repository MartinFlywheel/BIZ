import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendWhatsAppText } from '@/lib/services/meta-whatsapp'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Whop and Mercado Pago both point at this same route, distinguished by
// query params set once when configuring the webhook URL on each platform:
//   /api/webhooks/payments?source=whop&client_id=<uuid>&token=<PAYMENTS_WEBHOOK_TOKEN>
//   /api/webhooks/payments?source=mercadopago&client_id=<uuid>&token=<PAYMENTS_WEBHOOK_TOKEN>
// client_id ties the sale to a specific agency client (e.g. Mane) since a
// single Whop/MP account may eventually sell more than one client's program.

export async function POST(request: Request) {
  const supabase = createAdminClient()
  const url = new URL(request.url)
  const source = url.searchParams.get('source')
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
      .insert({
        source: `payments:${source || 'unknown'}`,
        event_type: body?.type || body?.action || 'payment',
        payload: body,
        processed: false,
      })
      .select('id')
      .single()
    webhookLogId = logRow?.id || null

    if (!clientId) {
      await markLog(supabase, webhookLogId, 'Missing client_id query param on webhook URL')
      return NextResponse.json({ error: 'Missing client_id' }, { status: 400 })
    }

    const buyer = source === 'mercadopago'
      ? await extractMercadoPagoBuyer(body)
      : extractWhopBuyer(body)

    if (!buyer) {
      await markLog(supabase, webhookLogId, `Could not extract buyer info from ${source} payload`)
      return NextResponse.json({ received: true, warning: 'No buyer info — logged for manual review' })
    }

    if (!buyer.email && !buyer.phone) {
      await markLog(supabase, webhookLogId, 'Buyer has neither email nor phone')
      return NextResponse.json({ received: true, warning: 'No contact info — logged for manual review' })
    }

    // ── Find or activate the student ──
    let query = supabase.from('program_students').select('id').eq('client_id', clientId)
    query = buyer.email ? query.eq('email', buyer.email) : query.eq('phone', buyer.phone!)
    const { data: existing } = await query.maybeSingle()

    let studentId: string
    let isNew = false

    if (existing) {
      studentId = existing.id
    } else {
      const { data: created, error: insertError } = await supabase
        .from('program_students')
        .insert({
          client_id: clientId,
          full_name: buyer.name || 'Alumna sin nombre',
          phone: buyer.phone || '',
          email: buyer.email,
          start_date: new Date().toISOString().slice(0, 10),
          current_day: 1,
          risk_level: 'green',
        })
        .select('id')
        .single()

      if (insertError || !created) {
        await markLog(supabase, webhookLogId, `Student insert failed: ${insertError?.message}`)
        return NextResponse.json({ error: 'Student creation failed' }, { status: 500 })
      }

      studentId = created.id
      isNew = true
    }

    // ── Send onboarding message (form + Skool link) on first activation ──
    if (isNew && buyer.phone && process.env.META_WHATSAPP_TOKEN) {
      const formUrl = process.env.PRODUCT_ONBOARDING_FORM_URL
      const skoolUrl = process.env.PRODUCT_SKOOL_URL
      const welcomeText = [
        `¡Hola${buyer.name ? ` ${buyer.name}` : ''}! Bienvenida al programa 🌿`,
        formUrl ? `Completa tu formulario de bienvenida aquí: ${formUrl}` : null,
        skoolUrl ? `Y súmate a la comunidad aquí: ${skoolUrl}` : null,
      ].filter(Boolean).join('\n')

      try {
        await sendWhatsAppText(buyer.phone, welcomeText)
        await supabase.from('student_messages').insert({
          student_id: studentId,
          sender: 'agency',
          message_text: welcomeText,
        })
      } catch (err) {
        console.error('[Payments] Onboarding WhatsApp send failed:', err)
      }
    }

    await markLog(supabase, webhookLogId, null)
    return NextResponse.json({ received: true, student_id: studentId, is_new: isNew })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Payments] Fatal error:', msg)
    await markLog(supabase, webhookLogId, msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

interface Buyer {
  name: string | null
  email: string | null
  phone: string | null
}

// Whop's exact event shape varies by API version — extraction is
// best-effort across the field names their docs/dashboard have used.
// Check webhook_logs.payload on the first real event and adjust here.
function extractWhopBuyer(body: any): Buyer | null {
  const data = body?.data || body
  const email = data?.user?.email || data?.email || data?.customer?.email || null
  const name = data?.user?.username || data?.user?.name || data?.customer?.name || null
  const phone = data?.user?.phone || data?.phone || null
  if (!email && !phone) return null
  return { name, email: email?.toLowerCase() || null, phone }
}

// Mercado Pago webhooks only carry a payment id — the real payer details
// require a follow-up call to their Payments API.
async function extractMercadoPagoBuyer(body: any): Promise<Buyer | null> {
  const paymentId = body?.data?.id
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN

  if (!paymentId || !accessToken) return null

  const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    console.error('[Payments] Mercado Pago lookup failed:', await response.text())
    return null
  }

  const payment = await response.json()
  if (payment.status !== 'approved') return null

  return {
    name: [payment.payer?.first_name, payment.payer?.last_name].filter(Boolean).join(' ') || null,
    email: payment.payer?.email?.toLowerCase() || null,
    phone: payment.payer?.phone?.number || null,
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
