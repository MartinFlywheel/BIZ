'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Users,
  FileText,
  Settings,
  Bell,
  LogOut,
  GalleryHorizontal,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface NavItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
}

const agencyNav: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Clientes', href: '/clients', icon: Users },
  { label: 'SOPs', href: '/sops', icon: FileText },
  { label: 'Configuración', href: '/settings', icon: Settings },
]

const portalNav: NavItem[] = [
  { label: 'Dashboard', href: '/portal/dashboard', icon: LayoutDashboard },
]

interface SidebarProps {
  userType: 'agency' | 'client'
  userName: string
}

export function Sidebar({ userType, userName }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const navItems = userType === 'agency' ? agencyNav : portalNav

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <aside className="relative z-10 my-3 ml-3 flex w-16 flex-col items-center rounded-2xl border border-white/[0.06] bg-white/[0.02] py-4 backdrop-blur-xl">
      {/* Brand */}
      <Link
        href={userType === 'agency' ? '/dashboard' : '/portal/dashboard'}
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#ff453a] shadow-[0_0_14px_rgba(255,69,58,0.5)]"
      >
        <span className="text-sm font-bold text-white">B</span>
      </Link>

      {/* Navigation icons */}
      <nav className="mt-6 flex flex-1 flex-col items-center gap-1.5">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={cn(
                'group relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200',
                isActive
                  ? 'bg-white/[0.07] text-white'
                  : 'text-zinc-500 hover:bg-white/[0.04] hover:text-white/90'
              )}
            >
              {/* Active accent bar — Raycast signature */}
              {isActive && (
                <span className="absolute -left-1 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-[#ff453a] shadow-[0_0_8px_rgba(255,69,58,0.7)]" />
              )}
              <item.icon className="h-[18px] w-[18px]" />

              {/* Tooltip */}
              <span className="pointer-events-none absolute left-full ml-3 z-50 whitespace-nowrap rounded-md border border-white/[0.08] bg-zinc-900/95 px-2 py-1 text-xs font-medium text-white/90 opacity-0 shadow-lg backdrop-blur-xl transition-opacity duration-200 group-hover:opacity-100">
                {item.label}
              </span>
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="mt-4 flex flex-col items-center gap-1.5 border-t border-white/[0.06] pt-4">
        {userType === 'agency' && (
          <Link
            href="/notifications"
            title="Notificaciones"
            className="group relative flex h-10 w-10 items-center justify-center rounded-xl text-zinc-500 transition-all duration-200 hover:bg-white/[0.04] hover:text-white/90"
          >
            <Bell className="h-[18px] w-[18px]" />
            <span className="pointer-events-none absolute left-full ml-3 z-50 whitespace-nowrap rounded-md border border-white/[0.08] bg-zinc-900/95 px-2 py-1 text-xs font-medium text-white/90 opacity-0 shadow-lg backdrop-blur-xl transition-opacity duration-200 group-hover:opacity-100">
              Notificaciones
            </span>
          </Link>
        )}

        {userType === 'agency' && (
          // Link cruzado — app de Carruseles, desplegada por separado.
          <a
            href="https://carruseles-three.vercel.app"
            target="_blank"
            rel="noopener noreferrer"
            title="Carruseles"
            className="group relative flex h-10 w-10 items-center justify-center rounded-xl text-zinc-500 transition-all duration-200 hover:bg-white/[0.04] hover:text-white/90"
          >
            <GalleryHorizontal className="h-[18px] w-[18px]" />
            <span className="pointer-events-none absolute left-full ml-3 z-50 whitespace-nowrap rounded-md border border-white/[0.08] bg-zinc-900/95 px-2 py-1 text-xs font-medium text-white/90 opacity-0 shadow-lg backdrop-blur-xl transition-opacity duration-200 group-hover:opacity-100">
              Carruseles
            </span>
          </a>
        )}

        <div
          title={userName}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] font-mono text-xs font-medium text-white/90"
        >
          {userName.charAt(0).toUpperCase()}
        </div>

        <button
          onClick={handleSignOut}
          title="Cerrar sesión"
          className="group relative flex h-10 w-10 items-center justify-center rounded-xl text-zinc-500 transition-all duration-200 hover:bg-white/[0.04] hover:text-white/90"
        >
          <LogOut className="h-[18px] w-[18px]" />
          <span className="pointer-events-none absolute left-full ml-3 z-50 whitespace-nowrap rounded-md border border-white/[0.08] bg-zinc-900/95 px-2 py-1 text-xs font-medium text-white/90 opacity-0 shadow-lg backdrop-blur-xl transition-opacity duration-200 group-hover:opacity-100">
            Cerrar sesión
          </span>
        </button>
      </div>
    </aside>
  )
}
