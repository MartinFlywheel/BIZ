import { createBrowserClient } from '@supabase/ssr'
import { fetchConReintento } from './retry-fetch'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    // Desde el navegador el transporte es aún menos confiable que desde el
    // servidor: wifi que parpadea, el equipo que vuelve de suspensión. Mismo
    // reintento, sólo para lecturas.
    { global: { fetch: fetchConReintento } }
  )
}
