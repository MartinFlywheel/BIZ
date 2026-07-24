import { updateSession } from '@/lib/supabase/middleware'
import { type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    // /roadmap/* is a bucket for standalone public pages (client-facing
    // deliverables, no login) served as plain static files from /public —
    // excluded here so they're never gated behind Supabase auth.
    '/((?!_next/static|_next/image|favicon.ico|roadmap/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
