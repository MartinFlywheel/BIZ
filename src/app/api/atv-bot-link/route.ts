import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { signAtvBotBridgeToken } from '@/lib/atv-bot-token'

export const dynamic = 'force-dynamic'

// Mismo chequeo de "admin autorizado" que src/app/(agency)/layout.tsx,
// duplicado a propósito: src/lib/supabase/middleware.ts salta /api/* sin
// procesar auth, así que esta ruta es el único punto de enforcement para
// el puente al bot y no puede asumir que el layout de agencia ya corrió.
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const { data: profile } = await supabase
    .from('users')
    .select('user_type, role')
    .eq('id', user.id)
    .single()

  const isAuthorizedAdmin = !!profile && profile.user_type === 'agency' && profile.role === 'admin'
  if (!isAuthorizedAdmin) {
    // No es un redirect a propósito — el sidebar ya oculta este link a
    // cualquiera que no sea admin autorizado, así que llegar acá significa
    // que alguien pegó la URL directamente. Un 403 plano alcanza.
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  const botUrl = process.env.ATV_BOT_URL
  const secret = process.env.ATV_BOT_ACCESS_SECRET
  if (!botUrl || !secret) {
    return NextResponse.json(
      { error: 'ATV_BOT_URL o ATV_BOT_ACCESS_SECRET no configurados' },
      { status: 500 }
    )
  }

  const token = signAtvBotBridgeToken(secret)
  return NextResponse.redirect(`${botUrl}/chat?t=${token}`)
}
