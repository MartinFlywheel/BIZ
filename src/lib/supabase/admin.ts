import { createClient } from '@supabase/supabase-js'
import { fetchConReintento } from './retry-fetch'

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    // Mismo reintento que el cliente de servidor: los crons y los webhooks
    // corren sin nadie mirando, así que un corte de transporte ahí se pierde
    // en silencio en vez de mostrar una pantalla de error.
    { global: { fetch: fetchConReintento } }
  )
}
