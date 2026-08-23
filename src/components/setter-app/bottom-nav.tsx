'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Users, CalendarCheck } from 'lucide-react'

export function BottomNav() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // Preserve the admin's picked client across tabs — otherwise switching to
  // Agendas would drop back to the client picker every time.
  const clientParam = searchParams.get('client')
  const suffix = clientParam ? `?client=${clientParam}` : ''

  const items = [
    { href: `/setter-app${suffix}`, label: 'Leads', icon: Users, matchPath: '/setter-app' },
    { href: `/setter-app/agendas${suffix}`, label: 'Agendas', icon: CalendarCheck, matchPath: '/setter-app/agendas' },
  ]

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-md border-t border-white/[0.06] bg-[#0B0B0B]/90 backdrop-blur-xl"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {items.map((item) => {
        const active = pathname === item.matchPath
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors ${
              active ? 'text-white' : 'text-zinc-500'
            }`}
          >
            <Icon className="h-5 w-5" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
