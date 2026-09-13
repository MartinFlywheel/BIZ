import { cache } from 'react'
import { createClient } from './server'

/**
 * El usuario y su perfil, una sola vez por request.
 *
 * El layout de la agencia y la página que renderiza dentro pedían cada uno
 * `auth.getUser()` —una llamada HTTP a Supabase Auth— y después el mismo
 * perfil de `users`. Al cambiar de pestaña eso eran cuatro viajes a la base
 * antes de empezar a pedir los datos de la pantalla. Con `cache` de React el
 * layout y la página comparten el resultado dentro del mismo render.
 */
export const getSessionUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})

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
