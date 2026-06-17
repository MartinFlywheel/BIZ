'use client'

import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

/**
 * PageTransition
 * Re-runs the `page-enter` animation each time the route changes by keying
 * the wrapper on the current pathname. Children that opt into `.stagger-children`
 * (e.g. the dashboard grid) will also re-trigger their fade-in.
 */
export function PageTransition({
    children,
    className,
}: {
    children: React.ReactNode
    className?: string
}) {
    const pathname = usePathname()

    return (
        <div key={pathname} className={cn('page-enter', className)}>
            {children}
        </div>
    )
}
