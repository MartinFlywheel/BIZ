import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/sidebar'
import { PageTransition } from '@/components/page-transition'
import { ParticleNetwork } from '@/components/particle-network'

export default async function AgencyLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('full_name, user_type, role, client_id')
    .eq('id', user.id)
    .single()

  if (!profile || profile.user_type === 'client') {
    redirect('/portal/dashboard')
  }

  const restricted = profile.role !== 'admin'

  // Non-admin with nobody having assigned them a client yet — nowhere valid
  // to send them (middleware can't redirect to a client page that doesn't
  // exist for them), so stop here instead of rendering an empty shell.
  if (restricted && !profile.client_id) {
    return (
      <div className="relative flex h-screen overflow-hidden bg-[#0B0B0B]">
        <div className="ambient-glow inset-x-0 -top-40 h-[80vh] w-full opacity-60" />
        <Sidebar userType="agency" userName={profile.full_name} homeHref="/login" restricted />
        <main className="relative z-10 flex flex-1 items-center justify-center px-4 pb-14 sm:pb-0">
          <p className="text-center text-sm text-zinc-500">Tu cuenta no tiene un cliente asignado. Contactá a un admin.</p>
        </main>
      </div>
    )
  }

  return (
    <div className="relative flex h-screen overflow-hidden bg-[#0B0B0B]">
      {/* Background Interactive Particle Network */}
      <ParticleNetwork />

      {/* Ambient glow bleeding down from the top and sides */}
      <div className="ambient-glow inset-x-0 -top-40 h-[80vh] w-full opacity-60 pointer-events-none" />
      <div className="ambient-glow -left-40 top-1/4 h-[60vh] w-[60vh] rounded-full opacity-40 blur-3xl pointer-events-none" />

      <Sidebar
        userType="agency"
        userName={profile.full_name}
        homeHref={restricted ? `/clients/${profile.client_id}` : '/dashboard'}
        restricted={restricted}
      />

      <main className="relative z-10 min-w-0 flex-1 overflow-y-auto pb-14 sm:pb-0">
        {/* Changed from max-w-7xl to w-full max-w-[2000px] to support 21:9 but keep laptop view intact */}
        <PageTransition className="mx-auto w-full max-w-[2000px] px-4 py-5 sm:px-8 sm:py-8 2xl:px-12">
          {children}
        </PageTransition>
      </main>
    </div>
  )
}
