import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exigirCronSecret } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // Ruta interna de diagnóstico: solo con la contraseña de los crons.
  const noAutorizado = exigirCronSecret(request)
  if (noAutorizado) return noAutorizado

  const supabase = createAdminClient()

  const { data: logs } = await supabase
    .from('webhook_logs')
    .select('id, source, event_type, processed, error, received_at')
    .order('received_at', { ascending: false })
    .limit(10)

  const { data: pieces } = await supabase
    .from('content_pieces')
    .select('id, client_id, ig_media_id, caption, ig_thumbnail_url, metrics_source, created_at')
    .eq('metrics_source', 'meta_api')
    .order('created_at', { ascending: false })
    .limit(5)

  return NextResponse.json({ recent_logs: logs, recent_api_pieces: pieces })
}
