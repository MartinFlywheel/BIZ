import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Early exit: never process auth logic for /login or /api routes
  if (pathname.startsWith('/login') || pathname.startsWith('/api')) {
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
      .select('user_type, role, client_id')
      .eq('id', user.id)
      .single()

    if (profile?.user_type === 'client') {
      const url = request.nextUrl.clone()
      url.pathname = '/portal/dashboard'
      return NextResponse.redirect(url)
    }

    // Non-admins don't get to stay logged in indefinitely like an admin can —
    // require a session-only marker cookie (set at login, no Max-Age) on
    // every request. Once the browser is fully closed the cookie is gone
    // even though the Supabase refresh-token cookie may still be valid, so
    // force them back through /login instead of silently letting them in.
    if (profile?.user_type === 'agency' && profile.role !== 'admin' && !request.cookies.has('biz_active_session')) {
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
    if (profile?.user_type === 'agency' && profile.role !== 'admin' && profile.client_id) {
      const allowedPath = `/clients/${profile.client_id}`
      if (pathname !== allowedPath && !pathname.startsWith(`${allowedPath}/`)) {
        const url = request.nextUrl.clone()
        url.pathname = allowedPath
        url.search = ''
        return NextResponse.redirect(url)
      }
    }
  }

  return supabaseResponse
}
