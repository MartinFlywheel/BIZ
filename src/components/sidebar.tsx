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
  // Non-admin agency users are scoped to one client — no cross-client nav,
  // no notifications/carruseles, just enough chrome to navigate their one
  // business (via that page's own tabs) and sign out.
  restricted?: boolean
  homeHref?: string
}

export function Sidebar({ userType, userName, restricted = false, homeHref }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const navItems = restricted ? [] : userType === 'agency' ? agencyNav : portalNav
  const brandHref = homeHref ?? (userType === 'agency' ? '/dashboard' : '/portal/dashboard')

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <aside
      className={cn(
        // Mobile: fixed bottom bar, out of document flow, row layout.
        'fixed inset-x-0 bottom-0 z-20 flex h-14 w-full flex-row items-center justify-around',
        'border-t border-white/[0.06] bg-zinc-950/95 backdrop-blur-xl',
        // Desktop (sm+): expanded glass sidebar with labels.
        'sm:relative sm:inset-auto sm:my-3 sm:ml-3 sm:h-auto sm:w-64 sm:flex-col sm:items-stretch sm:justify-start',
        'sm:rounded-3xl sm:border sm:border-white/[0.05] sm:bg-white/[0.03] sm:px-4 sm:py-6',
        'sm:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_4px_20px_rgba(0,0,0,0.5)] sm:backdrop-blur-2xl'
      )}
    >
      {/* Brand — desktop only, mobile keeps the bar compact */}
      <Link
        href={brandHref}
        className="mb-2 hidden items-center gap-3 px-2 sm:flex"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#8B0D1A] to-[#b01021] shadow-[0_0_14px_rgba(139,13,26,0.5)]">
          <span className="text-sm font-bold text-white">B</span>
        </div>
        <span className="text-lg font-bold tracking-tight text-white">BIZ</span>
      </Link>

      {/* Navigation */}
      <nav className="flex flex-1 flex-row items-center justify-around gap-1.5 sm:mt-8 sm:flex-col sm:items-stretch sm:justify-start">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={cn(
                'group relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-300',
                'sm:h-auto sm:w-full sm:justify-start sm:gap-3 sm:px-3 sm:py-2.5 sm:text-sm sm:font-medium',
                isActive
                  ? 'bg-white/[0.07] text-white sm:bg-gradient-to-r sm:from-[#8B0D1A] sm:to-transparent sm:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_8px_20px_rgba(139,13,26,0.25)]'
                  : 'text-zinc-500 hover:bg-white/[0.04] hover:text-white/90 sm:text-zinc-400'
              )}
            >
              {/* Active accent bar — desktop pill only */}
              {isActive && (
                <span className="absolute left-0 top-1/2 hidden h-6 w-1 -translate-y-1/2 rounded-r-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)] sm:block" />
              )}
              <item.icon className="h-[18px] w-[18px] shrink-0" />
              <span className="hidden sm:inline">{item.label}</span>
            </Link>
          )
        })}

        {/* Logout lives inline with nav on mobile to fit the bar */}
        <button
          onClick={handleSignOut}
          title="Cerrar sesión"
          className="group relative flex h-10 w-10 items-center justify-center rounded-xl text-zinc-500 transition-all duration-200 hover:bg-white/[0.04] hover:text-white/90 sm:hidden"
        >
          <LogOut className="h-[18px] w-[18px]" />
        </button>
      </nav>

      {/* Footer — desktop only; notifications/carruseles/avatar/logout */}
      <div className="mt-4 hidden flex-col gap-1.5 border-t border-white/[0.05] pt-4 sm:flex">
        {userType === 'agency' && !restricted && (
          <Link
            href="/notifications"
            className="group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-400 transition-all duration-300 hover:bg-white/[0.04] hover:text-white/90"
          >
            <Bell className="h-[18px] w-[18px] shrink-0" />
            <span>Notificaciones</span>
          </Link>
        )}

        {userType === 'agency' && !restricted && (
          // Link cruzado — app de Carruseles, desplegada por separado.
          <a
            href="https://carruseles-three.vercel.app"
            target="_blank"
            rel="noopener noreferrer"
            className="group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-400 transition-all duration-300 hover:bg-white/[0.04] hover:text-white/90"
          >
            <GalleryHorizontal className="h-[18px] w-[18px] shrink-0" />
            <span>Carruseles</span>
          </a>
        )}

        <div className="mt-2 flex items-center gap-3 px-3 py-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] font-mono text-xs font-medium text-white/90">
            {userName.charAt(0).toUpperCase()}
          </div>
          <div className="flex flex-col overflow-hidden">
            <span className="truncate text-sm font-medium text-white/90">{userName}</span>
            <span className="truncate text-xs text-zinc-500">{userType === 'agency' ? 'Agencia' : 'Cliente'}</span>
          </div>
        </div>

        <button
          onClick={handleSignOut}
          className="group relative mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-400 transition-all duration-300 hover:bg-[#8B0D1A]/10 hover:text-red-400"
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          <span>Cerrar sesión</span>
        </button>
      </div>
    </aside>
  )
}
