import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/sidebar'
import { PageTransition } from '@/components/page-transition'

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
      <div className="relative flex h-screen overflow-hidden bg-black">
        <div className="raycast-glow inset-x-0 top-0 h-[60vh]" />
        <Sidebar userType="agency" userName={profile.full_name} homeHref="/login" restricted />
        <main className="relative z-10 flex flex-1 items-center justify-center">
          <p className="text-sm text-zinc-500">Tu cuenta no tiene un cliente asignado. Contactá a un admin.</p>
        </main>
      </div>
    )
  }

  return (
    <div className="relative flex h-screen overflow-hidden bg-black">
      {/* Raycast warm glow bleeding down from the top */}
      <div className="raycast-glow inset-x-0 top-0 h-[60vh]" />

      <Sidebar
        userType="agency"
        userName={profile.full_name}
        homeHref={restricted ? `/clients/${profile.client_id}` : '/dashboard'}
        restricted={restricted}
      />

      <main className="relative z-10 min-w-0 flex-1 overflow-y-auto">
        <PageTransition className="mx-auto max-w-7xl px-8 py-8">
          {children}
        </PageTransition>
      </main>
    </div>
  )
}
