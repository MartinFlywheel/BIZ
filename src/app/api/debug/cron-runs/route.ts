import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = createAdminClient()
  const jobName = new URL(request.url).searchParams.get('job')

  let query = supabase
    .from('cron_runs')
    .select('job_name, ran_at, summary')
    .order('ran_at', { ascending: false })
    .limit(20)

  if (jobName) query = query.eq('job_name', jobName)

  const { data: runs, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ runs })
}
