import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { BottomNav } from '@/components/setter-app/bottom-nav'
import { LogoutButton } from '@/components/setter-app/logout-button'

// Deliberately its own top-level route — (agency) and (portal) both render
// the desktop Sidebar unconditionally in their layout, and a nested route
// can't opt out of an ancestor layout in the App Router. This one owns its
// own auth check instead of relying only on the middleware, matching how
// (agency)/layout.tsx and (portal)/layout.tsx already each re-check the
// profile themselves rather than trusting the request got this far safely.
export default async function SetterAppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('user_type, role, client_id, is_active')
    .eq('id', user.id)
    .single()

  if (!profile || profile.user_type !== 'agency' || profile.is_active === false) {
    redirect('/login')
  }

  // Esta app es una herramienta de setting: leads que tocar, agendas del día,
  // metas de ciclo y el reporte de cierre. Un `creador` no hace nada de eso —
  // su alcance es el panel de su cliente y nada más—, así que se lo manda ahí
  // en vez de dejarlo entrar a una app que no le corresponde. El middleware
  // deja pasar /setter-app a cualquier no-admin, así que el corte va acá.
  if (profile.role === 'creador') {
    redirect(profile.client_id ? `/clients/${profile.client_id}` : '/login')
  }

  return (
    <div
      className="min-h-screen bg-[#0B0B0B] text-white/90"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="ambient-glow inset-x-0 -top-40 h-[50vh] w-full opacity-50 pointer-events-none fixed" />
      {/* Fixed, not per-page — a few screens (the admin client picker, the
          "sin cliente asignado" message) never rendered their own header,
          so their per-page copy of this button was silently missing. */}
      <div
        className="fixed right-3 z-30"
        style={{ top: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
      >
        <LogoutButton />
      </div>
      {/* pb-20 clears the fixed BottomNav so the last card is never hidden behind it */}
      <div className="relative z-10 mx-auto max-w-md min-h-screen pb-20">
        {children}
      </div>
      <BottomNav />
    </div>
  )
}
