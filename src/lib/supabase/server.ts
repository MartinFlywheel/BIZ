import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { fetchConReintento } from './retry-fetch'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Un corte de transporte contra Supabase dejaba de ser un parpadeo y se
      // convertía en un 500 con pantalla blanca. Sólo reintenta lecturas (GET)
      // ante fallos de red o 5xx — ver retry-fetch.ts.
      global: { fetch: fetchConReintento },
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component — ignore
          }
        },
      },
    }
  )
}
