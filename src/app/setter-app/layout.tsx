import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { BottomNav } from '@/components/setter-app/bottom-nav'

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
    .select('user_type, is_active')
    .eq('id', user.id)
    .single()

  if (!profile || profile.user_type !== 'agency' || profile.is_active === false) {
    redirect('/login')
  }

  return (
    <div
      className="min-h-screen bg-[#0B0B0B] text-white/90"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="ambient-glow inset-x-0 -top-40 h-[50vh] w-full opacity-50 pointer-events-none fixed" />
      {/* pb-20 clears the fixed BottomNav so the last card is never hidden behind it */}
      <div className="relative z-10 mx-auto max-w-md min-h-screen pb-20">
        {children}
      </div>
      <BottomNav />
    </div>
  )
}
