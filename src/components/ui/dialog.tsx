'use client'

import { useEffect, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'

interface DialogProps {
    open: boolean
    onClose: () => void
    title: string
    description?: string
    children: ReactNode
    className?: string
}

export function Dialog({ open, onClose, title, description, children, className }: DialogProps) {
    // Close on Escape key
    useEffect(() => {
        if (!open) return
        function handleKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', handleKey)
        return () => document.removeEventListener('keydown', handleKey)
    }, [open, onClose])

    // Prevent body scroll when open
    useEffect(() => {
        if (open) {
            document.body.style.overflow = 'hidden'
        } else {
            document.body.style.overflow = ''
        }
        return () => { document.body.style.overflow = '' }
    }, [open])

    if (!open) return null

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
        >
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                onClick={onClose}
                aria-hidden="true"
            />

            {/* Panel */}
            <div
                className={cn(
                    'relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl',
                    className
                )}
            >
                {/* Header */}
                <div className="flex items-start justify-between p-6 pb-4">
                    <div>
                        <h2 id="dialog-title" className="text-lg font-semibold text-zinc-50">
                            {title}
                        </h2>
                        {description && (
                            <p className="mt-0.5 text-xs text-zinc-500 truncate max-w-[340px]">
                                {description}
                            </p>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="ml-4 mt-0.5 text-zinc-400 hover:text-zinc-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 rounded"
                        aria-label="Cerrar"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="px-6 pb-6">
                    {children}
                </div>
            </div>
        </div>
    )
}
