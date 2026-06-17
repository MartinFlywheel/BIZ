import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const payload = await request.json()

    console.log('[GoHighLevel Webhook]', JSON.stringify(payload))

    return NextResponse.json({ received: true })
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
}
