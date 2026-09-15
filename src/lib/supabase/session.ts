import { cache } from 'react'
import { createClient } from './server'

/** Lo mínimo que el resto del código necesita saber de quién está logueado. */
export interface SessionUser {
  id: string
  email: string | null
}

/**
 * El usuario y su perfil, una sola vez por request.
 *
 * El layout de la agencia y la página que renderiza dentro pedían cada uno
 * `auth.getUser()` —una llamada HTTP a Supabase Auth— y después el mismo
 * perfil de `users`. Al cambiar de pestaña eso eran cuatro viajes a la base
 * antes de empezar a pedir los datos de la pantalla. Con `cache` de React el
 * layout y la página comparten el resultado dentro del mismo render.
 *
 * Se usa `getClaims()` y no `getUser()`: el proyecto firma los JWT con una
 * llave asimétrica (ES256), así que la firma se valida aquí mismo contra la
 * JWKS cacheada, sin ir a Supabase Auth en cada request. La contrapartida es
 * que un token revocado sigue valiendo hasta que vence (1 h); por eso el
 * proxy mantiene el chequeo de `users.is_active` en cada request.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  const sub = data?.claims?.sub
  if (error || !sub) return null
  return { id: sub, email: (data.claims.email as string | undefined) ?? null }
})

/**
 * Para route handlers de /api que usa la app logueada.
 *
 * El proxy salta /api/* sin tocar la sesión (ver middleware.ts), así que el
 * chequeo de `users.is_active` que corta a una cuenta desactivada no corre para
 * estas rutas. Esto lo repite: sesión válida y usuario activo, o null.
 */
export async function getUsuarioActivoParaApi(): Promise<SessionUser | null> {
  const user = await getSessionUser()
  if (!user) return null
  const supabase = await createClient()
  const { data } = await supabase.from('users').select('is_active').eq('id', user.id).maybeSingle()
  if (!data || data.is_active === false) return null
  return user
}

export const getSessionProfile = cache(async () => {
  const user = await getSessionUser()
  if (!user) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from('users')
    .select('full_name, user_type, role, client_id')
    .eq('id', user.id)
    .single()
  return data ? { id: user.id, ...data } : null
})
