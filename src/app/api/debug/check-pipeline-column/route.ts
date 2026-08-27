import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const validSecrets = [process.env.CRON_SECRET, process.env.BACKFILL_SECRET].filter(Boolean)
  if (!validSecrets.some((s) => authHeader === `Bearer ${s}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('clients').select('pipeline_stages').limit(1)

  return NextResponse.json({ column_exists: !error, error: error?.message ?? null, code: error?.code ?? null })
}
