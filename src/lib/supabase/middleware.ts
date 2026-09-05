import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { ROLES_SESION_PERSISTENTE, type UserRole } from '@/lib/types'
import { fetchConReintento } from './retry-fetch'

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Early exit: never process auth logic for /login, /api, the public legal
  // pages (Meta's App Review needs to reach these without a session), or the
  // PWA manifest (the OS checks this for "Add to Home Screen" support
  // independent of whether anyone is logged in right now).
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/privacy') ||
    pathname.startsWith('/terms') ||
    pathname === '/manifest.webmanifest'
  ) {
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Este cliente corre en CADA request: un corte de transporte acá no
      // rompe una pantalla, las rompe todas.
      global: { fetch: fetchConReintento },
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Not authenticated — redirect to login
  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    const redirectResponse = NextResponse.redirect(url)
    // Carry over cookies set by Supabase during getUser()
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value)
    })
    return redirectResponse
  }

  // Client user trying to access agency routes — redirect to portal
  if (!pathname.startsWith('/portal')) {
    const { data: profile } = await supabase
      .from('users')
      .select('user_type, role, client_id, is_active')
      .eq('id', user.id)
      .single()

    // Deactivating someone in the database (without deleting their Supabase
    // Auth account) used to have no effect at all here — this check never
    // existed, so a revoked setter's session kept working everywhere,
    // including a device they'd installed the setter PWA on.
    if (profile && profile.is_active === false) {
      await supabase.auth.signOut()
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      const redirectResponse = NextResponse.redirect(url)
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie.name, cookie.value)
      })
      return redirectResponse
    }

    if (profile?.user_type === 'client') {
      const url = request.nextUrl.clone()
      url.pathname = '/portal/dashboard'
      return NextResponse.redirect(url)
    }

    // Los perfiles operativos no se quedan logueados indefinidamente: se les
    // exige una cookie de sesión (puesta al entrar, sin Max-Age) en cada
    // request. Cuando el navegador se cierra del todo la cookie desaparece
    // aunque el refresh token de Supabase siga vivo, así que vuelven a pasar
    // por /login en vez de entrar solos. Quiénes quedan exentos vive en
    // ROLES_SESION_PERSISTENTE, para que login y middleware no se
    // desincronicen.
    if (
      profile?.user_type === 'agency' &&
      !ROLES_SESION_PERSISTENTE.includes(profile.role as UserRole) &&
      !request.cookies.has('biz_active_session')
    ) {
      await supabase.auth.signOut()
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      const redirectResponse = NextResponse.redirect(url)
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie.name, cookie.value)
      })
      return redirectResponse
    }

    // Non-admin agency users (setter/closer/editor/...) each belong to one
    // business — confine them to that client's page. Someone with no
    // client_id yet is let through; the agency layout shows a "sin cliente
    // asignado" message for them instead of a redirect target that doesn't exist.
    // /setter-app is also allowed — it has its own auth check and scopes
    // itself to the caller's client_id already, same as /clients/{id} does.
    if (profile?.user_type === 'agency' && profile.role !== 'admin' && profile.client_id) {
      const allowedPath = `/clients/${profile.client_id}`
      if (
        pathname !== allowedPath &&
        !pathname.startsWith(`${allowedPath}/`) &&
        pathname !== '/setter-app' &&
        !pathname.startsWith('/setter-app/')
      ) {
        const url = request.nextUrl.clone()
        url.pathname = allowedPath
        url.search = ''
        return NextResponse.redirect(url)
      }
    }
  }

  return supabaseResponse
}
