'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError || !authData.user) {
      setError('Credenciales incorrectas')
      setLoading(false)
      return
    }

    const { data: profile } = await supabase
      .from('users')
      .select('id, user_type, role')
      .eq('id', authData.user.id)
      .single()

    if (!profile) {
      const { error: insertError } = await supabase.from('users').insert({
        id: authData.user.id,
        email: authData.user.email!,
        full_name: authData.user.email!.split('@')[0],
        user_type: 'agency',
        role: 'admin',
      })

      if (insertError) {
        setError('Error creando perfil: ' + insertError.message)
        setLoading(false)
        return
      }
    }

    // Non-admins get a session-only marker cookie (no Max-Age — cleared when
    // the browser fully closes, not just the tab). Middleware requires it on
    // every request; without it they're signed out and sent back here, so
    // they can't stay logged in indefinitely like an admin can.
    if (profile?.user_type === 'agency' && profile.role !== 'admin') {
      document.cookie = 'biz_active_session=1; path=/; SameSite=Lax'
    }

    const dest = profile?.user_type === 'client' ? '/portal/dashboard' : '/dashboard'
    router.push(dest)
    router.refresh()
  }

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-white">
            <span className="text-xl font-bold text-zinc-900">B</span>
          </div>
          <h1 className="mt-4 text-2xl font-semibold text-zinc-50">BIZ</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Inicia sesión para acceder al CRM
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <Input
            id="email"
            label="Email"
            type="email"
            placeholder="tu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            id="password"
            label="Contraseña"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Ingresando...' : 'Ingresar'}
          </Button>
        </form>
      </div>
    </div>
  )
}
