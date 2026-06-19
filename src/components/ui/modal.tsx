'use client'

import { cn } from '@/lib/utils'
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

const sizeClasses: Record<ModalSize, string> = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-3xl',
}

interface ModalProps {
    /** Whether to close when clicking the backdrop. Defaults to true. */
    closeOnBackdrop?: boolean
    onClose?: () => void
    size?: ModalSize
    className?: string
    children: ReactNode
}

/**
 * Viewport-anchored modal rendered through a React portal into <body>.
 *
 * Using createPortal guarantees the dialog escapes any ancestor with
 * `overflow: hidden` / `transform` / `position` so it is always centered
 * over the whole viewport and never clipped by a parent container.
 */
export function Modal({
    closeOnBackdrop = true,
    onClose,
    size = 'md',
    className,
    children,
}: ModalProps) {
    const [mounted, setMounted] = useState(false)

    // createPortal needs the DOM, so only render after mount (SSR-safe).
    useEffect(() => {
        setMounted(true)
    }, [])

    // Lock body scroll while the modal is open + close on Escape.
    useEffect(() => {
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'

        function handleKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose?.()
        }
        window.addEventListener('keydown', handleKey)

        return () => {
            document.body.style.overflow = previousOverflow
            window.removeEventListener('keydown', handleKey)
        }
    }, [onClose])

    if (!mounted) return null

    return createPortal(
        <div
            className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:items-center sm:py-8"
            onMouseDown={(e) => {
                // Only close when the backdrop itself is clicked (not inner content).
                if (closeOnBackdrop && e.target === e.currentTarget) onClose?.()
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                className={cn(
                    'my-auto w-full rounded-xl border border-white/[0.08] bg-zinc-900 p-6 shadow-2xl',
                    sizeClasses[size],
                    className
                )}
            >
                {children}
            </div>
        </div>,
        document.body
    )
}
