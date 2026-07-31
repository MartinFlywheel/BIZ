import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/sidebar'
import { PageTransition } from '@/components/page-transition'

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('full_name, user_type')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  return (
    <div className="relative flex h-screen overflow-hidden bg-[#0B0B0B]">
      {/* Ambient glow bleeding down from the top */}
      <div className="ambient-glow inset-x-0 -top-40 h-[80vh] w-full opacity-60" />

      <Sidebar userType={profile.user_type} userName={profile.full_name} />

      <main className="relative z-10 min-w-0 flex-1 overflow-y-auto pb-14 sm:pb-0">
        <PageTransition className="mx-auto max-w-7xl px-4 py-5 sm:px-8 sm:py-8">
          {children}
        </PageTransition>
      </main>
    </div>
  )
}
