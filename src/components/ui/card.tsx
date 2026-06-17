import { cn } from '@/lib/utils'
import { type HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> { }

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        // Raycast surface: pure-dark card, ultra-thin border, soft radius
        'rounded-xl border border-white/[0.06] bg-white/[0.02] p-6',
        className
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center justify-between mb-4', className)}
      {...props}
    />
  )
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-sm font-medium text-zinc-400', className)}
      {...props}
    />
  )
}

export function CardValue({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      // Metrics use monospaced font for that technical Raycast precision
      className={cn(
        'font-mono text-3xl font-semibold tracking-tight text-white',
        className
      )}
      {...props}
    />
  )
}
