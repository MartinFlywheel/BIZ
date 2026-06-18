import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createAdminClient()

  const checks: Record<string, unknown> = {
    supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'SET' : 'MISSING',
    supabase_anon_key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'SET' : 'MISSING',
    supabase_service_role: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'MISSING (using anon key)',
    meta_webhook_verify_token: process.env.META_WEBHOOK_VERIFY_TOKEN ? 'SET' : 'MISSING',
  }

  // Test insert
  const { data, error } = await supabase.from('webhook_logs').insert({
    source: 'debug',
    event_type: 'test',
    payload: { test: true, timestamp: new Date().toISOString() },
  }).select()

  checks.insert_result = error
    ? { status: 'FAILED', error: error.message, code: error.code, details: error.details }
    : { status: 'OK', row_id: data?.[0]?.id }

  // Check row count
  const { count } = await supabase
    .from('webhook_logs')
    .select('*', { count: 'exact', head: true })

  checks.total_webhook_logs = count

  return NextResponse.json(checks, { status: 200 })
}
